import { compactText, normalizeJobText, stripHtml, unescapeHtml } from '../utils.js';
import { BaseScraper } from './baseScraper.js';

const BASE_URL = 'https://www.myjobmag.com';
const DEFAULT_JOBS_URL = `${BASE_URL}/jobs-by-type/remote`;

export class MyJobMagScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('myjobmag', config, siteConfig);
  }

  async fetchJobs() {
    const boardUrls = resolveMyJobMagBoardUrls(this.siteConfig);
    await this.log(`Scanning ${boardUrls.length} MyJobMag board(s).`);

    const links = [];
    const seen = new Set();
    const maxPages = Math.max(1, Number.parseInt(this.siteConfig.maxPages || 2, 10));

    for (const boardUrl of boardUrls) {
      try {
        const html = await this.fetchText(boardUrl, { timeoutMs: resolveRequestTimeout(this.siteConfig, 15000) });
        const boardLinks = parseMyJobMagListingLinks(html, boardUrl);
        await this.log(`[${boardUrl}] returned ${boardLinks.length} job link(s).`);
        for (const link of boardLinks) {
          if (seen.has(link.jobUrl)) continue;
          seen.add(link.jobUrl);
          links.push(link);
        }

        // Check for pagination pages (e.g. /2, /3)
        for (let pageNum = 2; pageNum <= maxPages; pageNum++) {
          const pagedUrl = buildMyJobMagPageUrl(boardUrl, pageNum);
          try {
            const pageHtml = await this.fetchText(pagedUrl, { timeoutMs: resolveRequestTimeout(this.siteConfig, 12000) });
            const pagedLinks = parseMyJobMagListingLinks(pageHtml, pagedUrl);
            await this.log(`[${pagedUrl}] returned ${pagedLinks.length} job link(s).`);
            for (const link of pagedLinks) {
              if (seen.has(link.jobUrl)) continue;
              seen.add(link.jobUrl);
              links.push(link);
            }
          } catch (pErr) {
            await this.log(`Skipped page ${pageNum} for ${boardUrl}: ${pErr.message}`);
          }
        }
      } catch (error) {
        await this.log(`Skipped board ${boardUrl}: ${error.message}`);
      }
    }

    const knownUrls = this.config?.knownJobUrls instanceof Set
      ? this.config.knownJobUrls
      : new Set(this.config?.knownJobUrls || []);

    const candidateLinks = knownUrls.size > 0
      ? links.filter((link) => !knownUrls.has(link.jobUrl) && !knownUrls.has(link.applicationUrl))
      : links;

    const limit = resolveMyJobMagDetailScanLimit(this.siteConfig, this.resolveMaxJobsPerRun());
    const limitedLinks = limit > 0 ? candidateLinks.slice(0, limit) : candidateLinks;
    const jobs = [];
    const concurrency = Math.max(1, Number.parseInt(this.siteConfig.concurrency || 4, 10));

    for (let i = 0; i < limitedLinks.length; i += concurrency) {
      const chunk = limitedLinks.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        chunk.map(async (link) => {
          const detailHtml = await this.fetchText(link.jobUrl, { timeoutMs: resolveRequestTimeout(this.siteConfig, 12000) });
          return parseMyJobMagJobDetail(detailHtml, link.jobUrl, link);
        })
      );
      for (let j = 0; j < results.length; j++) {
        const res = results[j];
        if (res.status === 'fulfilled' && res.value) {
          jobs.push(res.value);
        } else if (res.status === 'rejected') {
          const reason = res.reason || {};
          const suffix = reason.code === 'ETIMEDOUT' ? ' (timeout; continuing with remaining details)' : '';
          await this.log(`Skipped detail for ${chunk[j]?.jobUrl}: ${reason.message || reason}${suffix}`);
        }
      }
    }

    const filteredJobs = sortMyJobMagJobsNewestFirst(filterMyJobMagJobsByPolicy(jobs, this.siteConfig));
    return filteredJobs;
  }

  normalizeJob(rawJob) {
    return super.normalizeJob({
      ...rawJob,
      source: 'myjobmag',
      source_site: 'myjobmag'
    });
  }
}

export async function scrapeMyJobMagJobs(config, siteConfig = {}) {
  return new MyJobMagScraper(config, siteConfig).scrape();
}

export function resolveMyJobMagBoardUrls(siteConfig = {}) {
  const explicit = toUrlList(siteConfig.jobsUrls);
  if (explicit.length) return dedupe(explicit);

  if (siteConfig.jobsUrl) return [siteConfig.jobsUrl];

  const categories = toUrlList(siteConfig.categories);
  if (categories.length) {
    return dedupe(categories.map((category) => myjobmagBoardUrl(category, siteConfig)));
  }

  return [DEFAULT_JOBS_URL];
}

export function myjobmagBoardUrl(category, siteConfig = {}) {
  const value = String(category || '').trim();
  if (!value) return DEFAULT_JOBS_URL;
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return `${BASE_URL}${value}`;

  const slug = value.replace(/^\/+|\/+$/g, '');
  if (slug.startsWith('cp/') || slug.startsWith('remote-')) {
    return `${BASE_URL}/${slug.startsWith('cp/') ? slug : `cp/${slug}`}`;
  }
  if (slug.startsWith('jobs-by-')) {
    return `${BASE_URL}/${slug}`;
  }

  // Default to remote job category page or field page
  return `${BASE_URL}/jobs-by-field/${slug}`;
}

export function buildMyJobMagPageUrl(baseUrl, pageNum) {
  const clean = baseUrl.replace(/\/+$/, '');
  return `${clean}/${pageNum}`;
}

// MyJobMag occasionally leaves a connection open for ~45s. Keep each board,
// pagination, and detail request bounded so one slow page cannot consume the
// whole scraper run. The outer scraper timeout remains the final backstop.
export function resolveRequestTimeout(siteConfig = {}, fallbackMs = 12000) {
  const configured = Number.parseInt(siteConfig.requestTimeoutMs ?? siteConfig.detailTimeoutMs, 10);
  const siteTimeout = Number.parseInt(siteConfig.timeoutMs, 10);
  const requested = Number.isFinite(configured) ? configured : (Number.isFinite(siteTimeout) ? siteTimeout : fallbackMs);
  return Math.max(3000, Math.min(requested, fallbackMs));
}

export function parseMyJobMagListingLinks(html, baseUrl = DEFAULT_JOBS_URL) {
  const links = [];
  const seen = new Set();
  const re = /<h2><a href=["'](\/job\/[^"']+)["'][^>]*>([\s\S]*?)<\/a><\/h2>/gi;
  let match;

  while ((match = re.exec(html || ''))) {
    const relativeUrl = match[1];
    const rawHeading = unescapeHtml(stripHtml(match[2])).trim();
    const fullJobUrl = new URL(relativeUrl, BASE_URL).toString();

    if (seen.has(fullJobUrl)) continue;
    seen.add(fullJobUrl);

    // Extract title & company from "Job Title at Company Name"
    const { title, company } = splitTitleAndCompany(rawHeading);

    links.push({
      jobUrl: fullJobUrl,
      applicationUrl: fullJobUrl,
      boardUrl: baseUrl,
      title,
      company,
      rawHeading,
      source: 'myjobmag',
      source_site: 'myjobmag'
    });
  }

  return links;
}

export function splitTitleAndCompany(rawHeading = '') {
  const text = compactText(rawHeading);
  const atIndex = text.lastIndexOf(' at ');
  if (atIndex > 0) {
    const title = text.slice(0, atIndex).trim();
    const company = text.slice(atIndex + 4).trim();
    return { title: title || text, company: company || '' };
  }
  return { title: text, company: '' };
}

export function parseMyJobMagJobDetail(html = '', jobUrl = '', fallback = {}) {
  // Extract Title from h1 or subjob-title
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const subJobMatch = html.match(/<span[^>]*class=['"]subjob-title['"][^>]*>([\s\S]*?)<\/span>/i);
  const rawTitle = subJobMatch ? stripHtml(subJobMatch[1]) : (h1Match ? stripHtml(h1Match[1]) : fallback.rawHeading || fallback.title || '');
  const { title: parsedTitle, company: parsedCompany } = splitTitleAndCompany(rawTitle);

  // Extract company from <a href="/jobs-at/...">View Jobs at Company</a>
  const companyMatch = html.match(/<a[^>]*href=["']\/jobs-at\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i);
  let company = parsedCompany;
  if (companyMatch) {
    const cleanCo = stripHtml(companyMatch[1]).replace(/^View Jobs at\s+/i, '').trim();
    if (cleanCo) company = cleanCo;
  }
  if (!company && fallback.company) company = fallback.company;

  // Extract Key Info from <ul class="job-key-info">
  const keyInfoMap = parseKeyInfo(html);
  const jobType = keyInfoMap['job type'] || '';
  const location = keyInfoMap['location'] || '';
  const experience = keyInfoMap['experience'] || '';
  const qualification = keyInfoMap['qualification'] || '';
  const jobField = keyInfoMap['job field'] || '';

  // Extract Date Posted
  const dateMatch = html.match(/id=["']posted-date["'][^>]*>[\s\S]*?<b[^>]*>Posted:<\/b>\s*([^<]+)/i)
    || html.match(/id=["']job-date["'][^>]*>\s*([^<]+)/i);
  let postedAt = '';
  if (dateMatch && dateMatch[1]) {
    const rawDate = compactText(dateMatch[1]);
    const parsed = Date.parse(rawDate);
    if (Number.isFinite(parsed)) {
      postedAt = new Date(parsed).toISOString();
    } else {
      postedAt = rawDate;
    }
  }

  // Extract Description from .job-details or .job-description
  let description = '';
  const detailsMatch = html.match(/<div class=["']job-details["']>([\s\S]*?)<\/div>\s*<div/i)
    || html.match(/<li[^>]*id=["']printable["'][^>]*class=["'][^"']*job-description[^"']*["']>([\s\S]*?)<\/li>/i);
  if (detailsMatch) {
    description = normalizeJobText(stripHtml(detailsMatch[1]));
  }

  // Extract Application / Apply link
  let applicationUrl = jobUrl;
  const applyLinkMatch = html.match(/href=["'](\/apply-now\/\d+)["']/i);
  if (applyLinkMatch) {
    applicationUrl = new URL(applyLinkMatch[1], BASE_URL).toString();
  }

  // Check for email application
  let applicantEmail = '';
  const emailMatch = description.match(/[\w.-]+@[\w.-]+\.[a-zA-Z]{2,}/i);
  if (emailMatch) {
    applicantEmail = emailMatch[0];
  }

  const hasFieldOrPhysicalWork = /\b(field visits?|field verification|spot checks?|door-to-door|loan recovery|debt collection|recovery officer|travel within the assigned region)\b/i.test(description);
  const hasCityBranchTitle = /-\s*(?:kano|lagos|abuja|calabar|port harcourt|ibadan|enugu|benin|kaduna|jos|asaba|warri|owerri|uyo|ilorin|abeokuta|akure)\b/i.test(parsedTitle) && !/\bremote\b/i.test(parsedTitle);
  const hasOnsiteOnlyMarker = hasFieldOrPhysicalWork || hasCityBranchTitle || /onsite|on-site|in-office|physical office/i.test(`${jobType} ${description.slice(0, 1000)}`);
  const hasRemoteMarker = /remote|telecommute|work from home|wfh/i.test(`${jobType} ${location} ${parsedTitle} ${description.slice(0, 500)}`);
  const isRemoteBoard = /remote/i.test(fallback.boardUrl || '');
  const isRemote = (hasRemoteMarker || isRemoteBoard) && !hasOnsiteOnlyMarker;

  return {
    source: 'myjobmag',
    source_site: 'myjobmag',
    title: parsedTitle || fallback.title || 'Untitled Role',
    company: company || 'Not listed',
    location: location || (isRemote ? 'Remote' : 'Nigeria'),
    jobType: jobType || 'Full Time',
    salary: '',
    description: description || fallback.description || '',
    requirements: experience ? `Experience: ${experience}. Qualification: ${qualification}.` : '',
    applicationUrl,
    postedAt,
    is_remote: isRemote,
    raw: {
      jobUrl,
      boardUrl: fallback.boardUrl || '',
      applyNowUrl: applyLinkMatch ? applicationUrl : null,
      applicantEmail: applicantEmail || null,
      jobType,
      experience,
      qualification,
      jobField
    }
  };
}

function parseKeyInfo(html = '') {
  const map = {};
  const re = /<li><span class=["']jkey-title["']>([^<]+)<\/span>\s*<span class=["']jkey-info["']>([\s\S]*?)<\/span><\/li>/gi;
  let match;
  while ((match = re.exec(html))) {
    const key = compactText(match[1]).toLowerCase();
    const val = compactText(stripHtml(match[2]));
    map[key] = val;
  }
  return map;
}

export function filterMyJobMagJobsByPolicy(jobs = [], siteConfig = {}) {
  const maxAgeDays = Number.parseInt(siteConfig.maxAgeDays, 10);
  const cutoff = Number.isFinite(maxAgeDays) && maxAgeDays > 0
    ? Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    : null;

  return jobs.filter((job) => {
    if (siteConfig.remoteOnly === true) {
      if (!job.is_remote) return false;
      const text = `${job.location} ${job.jobType} ${job.title} ${job.description.slice(0, 500)}`.toLowerCase();
      const mentionsRemote = /remote|telecommute|work from home|wfh/i.test(text);
      if (!mentionsRemote) return false;
      if (/^(lagos|abuja|ibadan|port harcourt|kano|enugu)$/i.test(job.location?.trim())) {
        return false;
      }
      if (/-\s*(?:kano|lagos|abuja|calabar|port harcourt|ibadan|enugu|benin|kaduna|jos|asaba|warri|owerri|uyo|ilorin|abeokuta|akure)\b/i.test(job.title) && !/\bremote\b/i.test(job.title)) {
        return false;
      }
      if (/\b(field visits?|field verification|spot checks?|door-to-door|loan recovery|debt collection|recovery officer)\b/i.test(job.description)) {
        return false;
      }
    }
    if (cutoff && job.postedAt) {
      const postedTime = Date.parse(job.postedAt);
      if (Number.isFinite(postedTime) && postedTime < cutoff) return false;
    }
    return true;
  });
}

export function sortMyJobMagJobsNewestFirst(jobs = []) {
  return [...jobs].sort((left, right) => {
    const leftTime = Date.parse(left.postedAt || '');
    const rightTime = Date.parse(right.postedAt || '');
    const leftRank = Number.isFinite(leftTime) ? leftTime : 0;
    const rightRank = Number.isFinite(rightTime) ? rightTime : 0;
    return rightRank - leftRank;
  });
}

export function resolveMyJobMagDetailScanLimit(siteConfig = {}, maxJobsPerRun = 15) {
  const explicit = Number.parseInt(siteConfig.detailScanLimit, 10);
  if (Number.isFinite(explicit)) return explicit;

  const runLimit = Number.parseInt(maxJobsPerRun, 10);
  if (!Number.isFinite(runLimit) || runLimit <= 0) return 0;
  return Math.min(Math.max(runLimit * 2, 20), 40);
}

function toUrlList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

function dedupe(items) {
  return [...new Set(items)];
}

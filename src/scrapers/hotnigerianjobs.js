import { BaseScraper, normalizeList } from './baseScraper.js';
import { isRecent, matchesGatewayJobPolicy } from './gatewaySourceHelpers.js';
import { compactText, stripHtml } from '../utils.js';

const DEFAULT_FEED_URL = 'http://www.hotnigerianjobs.com/feed/rss.xml';

export class HotNigerianJobsScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('hotnigerianjobs', config, siteConfig);
  }

  async fetchJobs() {
    const feedUrl = this.siteConfig.feedUrl || this.siteConfig.apiUrl || DEFAULT_FEED_URL;
    let xml = '';
    try {
      xml = await this.fetchText(feedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
    } catch (err) {
      await this.log(`Failed to fetch HotNigerianJobs RSS feed: ${err.message}`);
      return [];
    }

    const items = parseRssItems(xml);
    const limit = this.resolveMaxJobsPerRun();
    const targetItems = limit > 0 ? items.slice(0, Math.max(limit * 2, 25)) : items.slice(0, 30);

    const results = [];
    for (const item of targetItems) {
      try {
        const enriched = await this.enrichJobDetail(item);
        if (enriched) {
          if (Array.isArray(enriched)) {
            results.push(...enriched);
          } else {
            results.push(enriched);
          }
        }
      } catch (err) {
        await this.log(`Error enriching HotNigerianJobs listing "${item.title}": ${err.message}`);
        results.push(item);
      }
    }

    return results;
  }

  async enrichJobDetail(rawItem) {
    if (!rawItem.link) return rawItem;

    let html = '';
    try {
      html = await this.fetchText(rawItem.link, {
        timeoutMs: 12000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
    } catch {
      return rawItem;
    }

    // Check if this page is a multi-position announcement with sub-links
    const subPositions = extractSubPositions(html, rawItem);
    if (subPositions.length > 0) {
      const enrichedSubs = [];
      for (const sub of subPositions.slice(0, 5)) {
        try {
          const subHtml = await this.fetchText(sub.link, {
            timeoutMs: 12000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
          });
          enrichedSubs.push(parseJobDetailHtml(subHtml, sub));
        } catch {
          enrichedSubs.push(sub);
        }
      }
      return enrichedSubs;
    }

    const detail = parseJobDetailHtml(html, rawItem);
    return detail;
  }

  normalizeJob(rawJob = {}) {
    const company = compactText(
      rawJob.company || extractCompanyFromTitle(rawJob.title) || 'Company'
    );
    const location = compactText(rawJob.location || 'Nigeria');
    const isRemote = Boolean(
      rawJob.is_remote ??
      rawJob.isRemote ??
      /remote|work from home|wfh|anywhere/i.test(`${rawJob.title} ${rawJob.description} ${location}`)
    );

    const description = compactText(rawJob.description || rawJob.summary || '');
    const requirements = compactText(rawJob.requirements || '');
    const responsibilities = compactText(rawJob.responsibilities || '');

    const applyUrl = rawJob.externalApplyUrl || rawJob.applicationUrl || rawJob.link || '';
    const jobId = rawJob.id || extractJobIdFromUrl(rawJob.link) || '';

    const normalized = super.normalizeJob({
      source: 'hotnigerianjobs',
      source_site: 'hotnigerianjobs',
      sourceJobId: jobId,
      title: rawJob.title,
      company,
      location,
      jobType: rawJob.jobType || rawJob.employmentType || 'Full-time',
      salary: rawJob.salary || '',
      description,
      requirements,
      responsibilities,
      requiredSkills: rawJob.tags || [],
      tags: rawJob.tags || [],
      applicationUrl: applyUrl,
      postedAt: rawJob.postedAt || rawJob.pubDate || '',
      is_remote: isRemote,
      raw: {
        ...rawJob,
        hnjUrl: rawJob.link,
        decodedEmail: rawJob.decodedEmail,
        applySubject: rawJob.applySubject,
        applyMethod: rawJob.applyMethod
      }
    });

    return normalized;
  }

  filterJobsByPolicy(jobs = []) {
    const maxAgeDays = Number.isFinite(this.siteConfig.maxAgeDays) ? this.siteConfig.maxAgeDays : 30;
    const remoteOnly = Boolean(this.siteConfig.remoteOnly);

    return jobs.filter((job) => {
      if (maxAgeDays > 0 && job.postedAt && !isRecent(job.postedAt, maxAgeDays)) {
        return false;
      }
      if (!matchesGatewayJobPolicy(job, this.siteConfig)) {
        return false;
      }
      if (remoteOnly && !job.is_remote) {
        return false;
      }
      return true;
    });
  }
}

export function parseRssItems(xml = '') {
  if (!xml) return [];
  const items = [];
  const regex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = regex.exec(xml)) !== null) {
    const content = match[1];
    const titleMatch = content.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = content.match(/<link>([\s\S]*?)<\/link>/i);
    const descMatch = content.match(/<description>([\s\S]*?)<\/description>/i);
    const pubDateMatch = content.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);

    const title = compactText(stripHtml(titleMatch ? titleMatch[1] : ''));
    const link = compactText(linkMatch ? linkMatch[1] : '');
    const summary = compactText(stripHtml(descMatch ? descMatch[1] : ''));
    const pubDate = compactText(pubDateMatch ? pubDateMatch[1] : '');

    if (title && link) {
      items.push({
        title,
        link,
        summary,
        pubDate,
        id: extractJobIdFromUrl(link)
      });
    }
  }

  return items;
}

export function extractSubPositions(html = '', parentItem = {}) {
  const results = [];
  const parentCompany = extractCompanyFromTitle(parentItem.title) || '';

  // Look for sub-position patterns: 1.) Title Location: ... Click Here To View Details
  const blockRegex = /\d+\.\)(?:<\/strong>)?\s*(?:<strong>|&nbsp;|\s)*([\s\S]*?)(?:<\/strong>|<\/p>)([\s\S]*?)href="([^"]+)"[^>]*>(?:Click Here To View Details|View Details)/gi;
  let match;

  while ((match = blockRegex.exec(html)) !== null) {
    const rawTitle = compactText(stripHtml(match[1]));
    const middleText = match[2] || '';
    const link = compactText(match[3]);

    const locMatch = middleText.match(/Location:\s*([^<\n]+)/i);
    const location = locMatch ? compactText(stripHtml(locMatch[1])) : 'Nigeria';

    const salMatch = middleText.match(/Salary:\s*([^<\n]+)/i);
    const salary = salMatch ? compactText(stripHtml(salMatch[1])) : '';

    if (rawTitle && link) {
      results.push({
        title: rawTitle,
        company: parentCompany,
        location: location || 'Nigeria',
        salary,
        link,
        id: extractJobIdFromUrl(link),
        pubDate: parentItem.pubDate,
        parentTitle: parentItem.title
      });
    }
  }

  return results;
}

export function parseJobDetailHtml(html = '', baseItem = {}) {
  const cfMatch = html.match(/data-cfemail="([a-f0-9]+)"/i);
  const decodedEmail = cfMatch ? decodeCfEmail(cfMatch[1]) : null;

  const normalizedHtml = html
    .replace(/&(?:ldquo|rdquo|#8220|#8221);/gi, '"')
    .replace(/&(?:lsquo|rsquo|#8216|#8217);/gi, "'")
    .replace(/&(?:nbsp|#160);/gi, ' ');
  const subjectMatch = normalizedHtml.match(/using\s+["“'‘]+([^"”'’]+)["”'’]+\s+as\s+the\s+subject/i)
    || normalizedHtml.match(/subject\s+of\s+the\s+(?:email|mail)\s+(?:should\s+be\s+)?["“'‘]+([^"”'’]+)["”'’]+/i)
    || normalizedHtml.match(/subject:\s*["“'‘]?([^"”'’<\n]+)["”'’]?/i);
  const applySubject = subjectMatch ? compactText(subjectMatch[1]) : '';

  const extMatch = html.match(/href="(https?:\/\/(?!www\.hotnigerianjobs|www\.facebook|twitter|linkedin|plus\.google)[^"]+)"[^>]*>(?:Click here to apply|Apply here|Click here|Click Here To Apply|Apply Online)/i);
  const externalApplyUrl = extMatch ? extMatch[1] : null;

  const locationMatch = html.match(/<strong>Location:\s*<\/strong>\s*([^<\n]+)/i);
  const location = locationMatch ? compactText(stripHtml(locationMatch[1])) : (baseItem.location || 'Nigeria');

  const salaryMatch = html.match(/<strong>\s*Salary:?\s*<\/strong>(?:<br\s*\/?>)?\s*([^<\n]+)/i)
    || html.match(/Salary:\s*(?:&nbsp;)?\s*([^<\n]+)/i);
  const salary = salaryMatch ? compactText(stripHtml(salaryMatch[1])) : (baseItem.salary || '');

  const descMatch = html.match(/<div class=['"]mycase4['"]>([\s\S]*?)<div class=['"]mycase4['"]>/i);
  const rawBody = descMatch ? descMatch[1] : html;
  const description = compactText(stripHtml(rawBody));

  const applyMethod = externalApplyUrl ? 'external_url' : (decodedEmail ? 'email' : 'direct');

  return {
    ...baseItem,
    location,
    salary,
    description,
    decodedEmail,
    applySubject,
    externalApplyUrl,
    applyMethod,
    applicationUrl: externalApplyUrl || baseItem.link
  };
}

export function decodeCfEmail(encoded = '') {
  if (!encoded || encoded.length < 2) return '';
  let email = '';
  const r = parseInt(encoded.substring(0, 2), 16);
  for (let n = 2; n < encoded.length; n += 2) {
    const c = parseInt(encoded.substring(n, n + 2), 16) ^ r;
    email += String.fromCharCode(c);
  }
  return email;
}

export function extractCompanyFromTitle(title = '') {
  if (!title) return '';
  const atMatch = title.match(/at\s+([^-–—]+?)(?:\s+-\s+.*|\s*\([^)]*\))?$/i);
  if (atMatch) return compactText(atMatch[1]);

  const recruitMatch = title.match(/^([^-–—]+?)\s+(?:Job\s+)?Recruitment/i);
  if (recruitMatch) return compactText(recruitMatch[1]);

  return '';
}

export function extractJobIdFromUrl(url = '') {
  const match = String(url || '').match(/\/hotjobs\/(\d+)\//);
  return match ? match[1] : '';
}

export async function scrapeHotNigerianJobs(config, siteConfig = {}) {
  return new HotNigerianJobsScraper(config, siteConfig).scrape();
}

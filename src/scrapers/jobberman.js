import { compactText, normalizeJobText, stripHtml } from '../utils.js';
import { BaseScraper } from './baseScraper.js';

const DEFAULT_JOBS_URL = 'https://www.jobberman.com/jobs/customer-service-support/remote';

export class JobbermanScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('jobberman', config, siteConfig);
  }

  async fetchJobs() {
    const jobsUrl = this.siteConfig.jobsUrl || DEFAULT_JOBS_URL;
    const html = await this.fetchText(jobsUrl);
    const links = parseJobbermanListingLinks(html, jobsUrl);
    await this.log(`Listing page returned ${links.length} job link(s).`);

    const limit = this.resolveMaxJobsPerRun();
    const limitedLinks = limit > 0 ? links.slice(0, limit) : links;
    const jobs = [];

    for (const link of limitedLinks) {
      try {
        const detailHtml = await this.fetchText(link.jobUrl);
        jobs.push(parseJobbermanJobDetail(detailHtml, link.jobUrl, link));
      } catch (error) {
        await this.log(`Skipped detail for ${link.jobUrl}: ${error.message}`);
      }
    }

    return filterJobbermanJobsByPolicy(jobs, this.siteConfig);
  }

  normalizeJob(rawJob) {
    return super.normalizeJob({
      ...rawJob,
      source: 'jobberman',
      source_site: 'jobberman'
    });
  }
}

export async function scrapeJobbermanJobs(config, siteConfig = {}) {
  return new JobbermanScraper(config, siteConfig).scrape();
}

export function parseJobbermanListingLinks(html, baseUrl = DEFAULT_JOBS_URL) {
  const links = [];
  const seen = new Set();
  const re = /href=["']([^"']*\/listings\/[^"']+)["']/gi;
  let match;

  while ((match = re.exec(html || ''))) {
    const jobUrl = new URL(match[1], baseUrl).toString();
    if (seen.has(jobUrl)) continue;
    seen.add(jobUrl);
    links.push({
      jobUrl,
      applicationUrl: jobUrl,
      source: 'jobberman',
      source_site: 'jobberman'
    });
  }

  return links;
}

export function parseJobbermanJobDetail(html, jobUrl, fallback = {}) {
  const graph = readJsonLdGraph(html);
  const job = graph.find((item) => item?.['@type'] === 'JobPosting') || {};
  const hiringOrg = resolveGraphReference(graph, job.hiringOrganization);
  const salary = formatSalary(job.baseSalary);
  const description = normalizeJobText(stripHtml(job.description || ''));

  return {
    source: 'jobberman',
    source_site: 'jobberman',
    sourceJobId: sourceJobIdFromUrl(jobUrl, job['@id']),
    title: compactText(job.title || fallback.title),
    company: compactText(hiringOrg?.name || ''),
    location: locationForJob(job),
    jobType: compactText(job.employmentType || ''),
    salary,
    description,
    requirements: compactText(stripHtml(job.qualifications || '')),
    responsibilities: extractSection(description, 'Responsibilities', ['Requirements', 'What We Offer']),
    applicationUrl: jobUrl,
    jobUrl,
    postedAt: compactText(job.datePosted || ''),
    raw: {
      jobUrl,
      directApply: job.directApply === true,
      validThrough: job.validThrough || '',
      occupationalCategory: job.occupationalCategory || '',
      applicantLocationRequirements: job.applicantLocationRequirements || null
    }
  };
}

export function filterJobbermanJobsByPolicy(jobs, siteConfig = {}) {
  const maxAgeDays = Number.parseInt(siteConfig.maxAgeDays, 10);
  const cutoff = Number.isFinite(maxAgeDays) && maxAgeDays > 0
    ? Date.now() - maxAgeDays * 24 * 60 * 60 * 1000
    : null;

  return jobs.filter((job) => {
    if (siteConfig.remoteOnly === true && !/remote|work from home|telecommute/i.test(`${job.location} ${job.raw?.jobLocationType || ''}`)) {
      return false;
    }
    if (cutoff) {
      const postedAt = Date.parse(job.postedAt || '');
      if (!Number.isFinite(postedAt) || postedAt < cutoff) return false;
    }
    return true;
  });
}

function readJsonLdGraph(html) {
  const scripts = [...String(html || '').matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script[1]);
      if (Array.isArray(parsed?.['@graph'])) return parsed['@graph'];
      if (parsed?.['@type']) return [parsed];
    } catch {
      // Ignore unrelated/invalid JSON-LD blocks.
    }
  }
  return [];
}

function resolveGraphReference(graph, reference) {
  const id = typeof reference === 'string' ? reference : reference?.['@id'];
  if (!id) return null;
  return graph.find((item) => item?.['@id'] === id) || null;
}

function formatSalary(baseSalary) {
  const currency = baseSalary?.currency || '';
  const value = baseSalary?.value || {};
  const min = value.minValue || value.value || '';
  const max = value.maxValue && value.maxValue !== min ? value.maxValue : '';
  const unit = value.unitText || '';
  return compactText([currency, max ? `${min}-${max}` : min, unit].filter(Boolean).join(' '));
}

function locationForJob(job) {
  if (job.jobLocationType === 'TELECOMMUTE') {
    const country = job.applicantLocationRequirements?.name;
    return country ? `Remote (${country})` : 'Remote';
  }
  const location = job.jobLocation;
  const address = Array.isArray(location) ? location[0]?.address : location?.address;
  return compactText([
    address?.addressLocality,
    address?.addressRegion,
    address?.addressCountry
  ].filter(Boolean).join(', '));
}

function extractSection(text, startLabel, stopLabels = []) {
  const start = text.toLowerCase().indexOf(startLabel.toLowerCase());
  if (start === -1) return '';
  const fromStart = text.slice(start + startLabel.length).trim();
  const stopPositions = stopLabels
    .map((label) => fromStart.toLowerCase().indexOf(label.toLowerCase()))
    .filter((index) => index >= 0);
  const end = stopPositions.length ? Math.min(...stopPositions) : fromStart.length;
  return normalizeJobText(fromStart.slice(0, end));
}

function sourceJobIdFromUrl(jobUrl, schemaId = '') {
  const idMatch = /listing-(\d+)/.exec(schemaId);
  if (idMatch) return idMatch[1];
  return new URL(jobUrl).pathname.split('/').filter(Boolean).at(-1) || jobUrl;
}

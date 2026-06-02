import { compactText, normalizeJobText, stripHtml } from '../utils.js';
import { BaseScraper } from './baseScraper.js';

export class BruntWorkScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('bruntwork', config, siteConfig);
  }

  async fetchJobs() {
    const jobsUrl = this.siteConfig.jobsUrl || this.config.jobsUrl;
    const html = await this.fetchText(jobsUrl);
    const jobLinks = parseListingLinks(html, jobsUrl);
    await this.log(`Listing page returned ${jobLinks.length} job link(s).`);

    const limit = this.resolveMaxJobsPerRun();
    const limitedJobLinks = limit > 0 ? jobLinks.slice(0, limit) : jobLinks;
    const jobs = [];

    for (const [index, link] of limitedJobLinks.entries()) {
      try {
        const detailHtml = await this.fetchText(link.applicationUrl);
        const detail = parseJobDetail(detailHtml, link);
        jobs.push(detail);
        await this.log(`Scraped job detail: ${detail.title}`);
      } catch (error) {
        await this.log(`Skipped detail (${index + 1}/${limitedJobLinks.length}) for ${link.applicationUrl}: ${error.message}`);
      }
    }

    return jobs;
  }

  normalizeJob(rawJob) {
    return super.normalizeJob({
      ...rawJob,
      source: 'bruntwork',
      source_site: 'bruntwork'
    });
  }
}

export async function scrapeBruntWorkJobs(config, siteConfig = {}) {
  return new BruntWorkScraper(config, siteConfig).scrape();
}

export function parseListingLinks(html, baseUrl) {
  const re = /<a[^>]*href="(\/jobs\/\d+)"[^>]*>([\s\S]*?)<\/a>/g;
  const seen = new Set();
  const links = [];
  let m;
  while ((m = re.exec(html))) {
    const path = m[1];
    if (seen.has(path)) continue;
    seen.add(path);
    const innerText = htmlToText(m[2]);
    links.push({
      title: compactText(innerText) || 'Untitled BruntWork role',
      applicationUrl: new URL(path, baseUrl).toString(),
      source: 'bruntwork',
      source_site: 'bruntwork'
    });
  }
  return links;
}

export function parseJobDetail(html, link) {
  const title = firstMatch(html, [
    /<p[^>]*class="[^"]*text-4xl[^"]*"[^>]*>([\s\S]*?)<\/p>/i,
    /<p[^>]*class="[^"]*text-3xl[^"]*"[^>]*>([\s\S]*?)<\/p>/i
  ]) || link.title;
  const descriptionHtml = firstMatchRaw(html, [
    /<div[^>]*class="[^"]*job-description[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div[^>]*class="[^"]*rounded-2xl/i,
    /<div[^>]*class="[^"]*job-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i
  ]);
  const sidebar = extractSidebar(html);
  const body = htmlToText(descriptionHtml || html);
  const overview = findSection(body, ['client overview', 'job overview', 'about the role', 'about this role', 'position overview', 'position summary', 'the opportunity']);
  const jobDescription = findSection(body, ['job description']);
  const responsibilities = findSection(body, ['core responsibilities', 'responsibilities', 'what you will do', 'duties']);
  const requirements = findSection(body, ['requirements', 'qualifications', 'must have']);
  const descParts = [overview, jobDescription, responsibilities, requirements].filter(Boolean);

  return {
    source: 'bruntwork',
    source_site: 'bruntwork',
    title: compactText(title),
    description: normalizeJobText(descParts.length > 0 ? descParts.join('\n\n') : body),
    applicationUrl: link.applicationUrl,
    requirements: normalizeJobText(requirements),
    responsibilities: normalizeJobText(responsibilities),
    jobType: sidebar.jobType,
    postedAt: sidebar.postedAt
  };
}

function firstMatch(html, patterns) {
  const raw = firstMatchRaw(html, patterns);
  return raw ? htmlToText(raw) : '';
}

function firstMatchRaw(html, patterns) {
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

function extractSidebar(html) {
  const text = htmlToText(String(html || '').match(/<div[^>]*class="[^"]*w-1\/4[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] || '');
  const jobType = text.match(/Job Type\s+(.+?)\s+Work Schedule/i)?.[1] || '';
  const postedAt = text.match(/Published on\s+([A-Za-z]{3}\s+\d{2}\s+\d{4})/i)?.[1] || '';
  return { jobType: compactText(jobType), postedAt: compactText(postedAt) };
}

function htmlToText(html) {
  const withBreaks = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n');
  return stripHtml(withBreaks)
    .replace(/&nbsp;/gi, ' ')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => compactText(line))
    .filter(Boolean)
    .join('\n');
}

function findSection(body, names) {
  const lines = String(body || '')
    .split(/\n|(?=(?:Client Overview|Job Description|Core Responsibilities|Requirements|Qualifications):?)/i)
    .map((line) => compactText(line))
    .filter(Boolean);
  const start = lines.findIndex((line) =>
    names.some((name) => line.toLowerCase().includes(name))
  );
  if (start === -1) return '';
  const end = lines.findIndex(
    (line, index) =>
      index > start &&
      /^(client overview|job description|core responsibilities|requirements|responsibilities|qualifications|benefits|schedule|role|what you)/i.test(line)
  );
  return lines.slice(start, end === -1 ? start + 8 : end).join('\n');
}

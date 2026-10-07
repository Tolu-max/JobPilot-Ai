import { compactText, normalizeJobText, stripHtml } from '../utils.js';
import { BaseScraper } from './baseScraper.js';

const DEFAULT_URL = 'https://jobgurus.com.ng/jobs';

export class JobGurusScraper extends BaseScraper {
  constructor(config, siteConfig = {}) { super('jobgurus', config, siteConfig); }
  async fetchJobs() {
    const url = this.siteConfig.jobsUrl || DEFAULT_URL;
    const html = await this.fetchText(url); const links = parseJobGurusLinks(html, url); const jobs = [];
    for (const link of links.slice(0, this.resolveMaxJobsPerRun() || links.length)) {
      try { jobs.push(parseJobGurusDetail(await this.fetchText(link.jobUrl), link.jobUrl, link)); }
      catch (error) { await this.log(`Skipped detail for ${link.jobUrl}: ${error.message}`); }
    }
    return jobs;
  }
  normalizeJob(rawJob) { return super.normalizeJob({ ...rawJob, source: 'jobgurus', source_site: 'jobgurus' }); }
}

export async function scrapeJobGurusJobs(config, siteConfig = {}) { return new JobGurusScraper(config, siteConfig).scrape(); }

export function parseJobGurusLinks(html, baseUrl = DEFAULT_URL) {
  const seen = new Set(); const links = [];
  for (const match of String(html || '').matchAll(/href=["']([^"']*\/jobs\/view\/[^"']+)["']/gi)) {
    const jobUrl = new URL(match[1], baseUrl).toString().split('#')[0];
    if (seen.has(jobUrl)) continue; seen.add(jobUrl); links.push({ jobUrl, applicationUrl: jobUrl });
  }
  return links;
}

export function parseJobGurusDetail(html, jobUrl, fallback = {}) {
  const text = normalizeJobText(stripHtml(html));
  const title = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || firstMatch(html, /<h2[^>]*>([\s\S]*?)<\/h2>/i) || fallback.title || '';
  return { source: 'jobgurus', source_site: 'jobgurus', sourceJobId: new URL(jobUrl).pathname.split('/').filter(Boolean).at(-1), title: compactText(stripHtml(title)), company: compactText(firstMatch(text, /Company\s*:?\s*([^|\n]+)/i)), location: compactText(firstMatch(text, /Location\s*:?\s*([^|\n]+)/i)), description: text, requirements: text, applicationUrl: jobUrl, jobUrl, raw: { jobUrl } };
}

function firstMatch(value, pattern) { const match = pattern.exec(value || ''); return match ? match[1] : ''; }

import { compactText, normalizeJobText, stripHtml } from '../utils.js';
import { BaseScraper } from './baseScraper.js';

const DEFAULT_URL = 'https://jobzilla.ng/';

export class JobzillaScraper extends BaseScraper {
  constructor(config, siteConfig = {}) { super('jobzilla', config, siteConfig); }

  async fetchJobs() {
    const html = await this.fetchText(this.siteConfig.jobsUrl || DEFAULT_URL);
    const links = parseJobzillaLinks(html, this.siteConfig.jobsUrl || DEFAULT_URL);
    const jobs = [];
    for (const link of links.slice(0, this.resolveMaxJobsPerRun() || links.length)) {
      try {
        const detail = await this.fetchText(link.jobUrl);
        jobs.push(parseJobzillaDetail(detail, link.jobUrl, link));
      } catch (error) { await this.log(`Skipped detail for ${link.jobUrl}: ${error.message}`); }
    }
    return jobs;
  }

  normalizeJob(rawJob) { return super.normalizeJob({ ...rawJob, source: 'jobzilla', source_site: 'jobzilla' }); }
}

export async function scrapeJobzillaJobs(config, siteConfig = {}) { return new JobzillaScraper(config, siteConfig).scrape(); }

export function parseJobzillaLinks(html, baseUrl = DEFAULT_URL) {
  const seen = new Set(); const links = [];
  for (const match of String(html || '').matchAll(/href=["']([^"']*\/jobs\/[^"']+)["']/gi)) {
    const jobUrl = new URL(match[1], baseUrl).toString().split('#')[0];
    if (!/jobzilla\.ng\/jobs\//i.test(jobUrl) || seen.has(jobUrl)) continue;
    seen.add(jobUrl); links.push({ jobUrl, applicationUrl: jobUrl });
  }
  return links;
}

export function parseJobzillaDetail(html, jobUrl, fallback = {}) {
  const text = normalizeJobText(stripHtml(html));
  const title = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || fallback.title || '';
  return { source: 'jobzilla', source_site: 'jobzilla', sourceJobId: new URL(jobUrl).pathname.split('/').filter(Boolean).at(-1), title: compactText(stripHtml(title)), company: compactText(firstMatch(text, /Company\s*:?\s*([^|\n]+)/i)), location: compactText(firstMatch(text, /Location\s*:?\s*([^|\n]+)/i)), description: text, requirements: text, applicationUrl: jobUrl, jobUrl, raw: { jobUrl } };
}

function firstMatch(value, pattern) { const match = pattern.exec(value || ''); return match ? match[1] : ''; }

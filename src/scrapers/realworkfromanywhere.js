import { BaseScraper, normalizeList } from './baseScraper.js';
import { compactText, stripHtml } from '../utils.js';
import { extractApplyUrlFromHtml, matchesGatewayJobPolicy, parseSimpleRss } from './gatewaySourceHelpers.js';

const DEFAULT_FEEDS = [
  'https://www.realworkfromanywhere.com/rss.xml',
  'https://www.realworkfromanywhere.com/remote-customer-support-jobs/rss.xml'
];
const SAME_HOST_PATTERNS = [/realworkfromanywhere\.com/i];

export class RealWorkFromAnywhereScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('realworkfromanywhere', config, siteConfig);
  }

  async fetchJobs() {
    const feeds = normalizeList(this.siteConfig.feeds || this.siteConfig.feedUrls || this.siteConfig.feedUrl);
    const targets = feeds.length ? feeds : DEFAULT_FEEDS;
    const jobs = [];

    for (const feedUrl of targets) {
      try {
        const xml = await this.fetchText(feedUrl);
        const items = parseSimpleRss(xml);
        jobs.push(...items);
      } catch (error) {
        await this.log(`Feed skipped (${feedUrl}): ${error.message}`);
      }
    }

    const uniqueJobs = Array.from(new Map(
      jobs.map((job) => [job.guid || job.link, job])
    ).values());
    uniqueJobs.sort((left, right) => Date.parse(right.pubDate || '') - Date.parse(left.pubDate || ''));

    const limit = this.resolveMaxJobsPerRun() || 40;
    const scanLimit = Math.max(limit * 3, 60);
    return Promise.all(uniqueJobs.slice(0, scanLimit).map((item) => this.enrichItem(item).catch(() => item)));
  }

  async enrichItem(item) {
    const pageUrl = item.link || '';
    if (!pageUrl) return item;
    const html = await this.fetchText(pageUrl);
    const applyUrl = extractApplyUrlFromHtml(html, { sameHostPatterns: SAME_HOST_PATTERNS, pageUrl });
    return { ...item, applyUrl, detailHtml: html };
  }

  normalizeJob(rawJob) {
    const [titlePart, companyPart] = String(rawJob.title || '').split(/\s+at\s+/i);
    const description = compactText(stripHtml(rawJob.description || rawJob.detailHtml || ''));
    return super.normalizeJob({
      source: 'realworkfromanywhere',
      source_site: 'realworkfromanywhere',
      sourceJobId: rawJob.guid || rawJob.link,
      title: compactText(titlePart || rawJob.title),
      company: compactText(companyPart || ''),
      location: inferLocation(description) || 'Remote',
      description,
      requirements: extractSegment(description, /(requirements|qualifications|what you(?:'|’)?ll bring)/i),
      responsibilities: extractSegment(description, /(responsibilities|what you(?:'|’)?ll do|key responsibilities)/i),
      requiredSkills: [],
      tags: normalizeList(rawJob.category),
      applicationUrl: rawJob.applyUrl || rawJob.link,
      postedAt: rawJob.pubDate,
      raw: rawJob
    });
  }

  matchesSitePolicy(job) {
    if (!super.matchesSitePolicy(job)) return false;
    return matchesGatewayJobPolicy(job, this.siteConfig);
  }
}

function inferLocation(text) {
  const match = String(text || '').match(/\b(remote|worldwide|anywhere|global)\b/i);
  return match?.[0] ? match[0].replace(/\b\w/g, (char) => char.toUpperCase()) : '';
}

function extractSegment(text, marker) {
  const match = String(text || '').match(new RegExp(`${marker.source}[\\s\\S]{0,1000}`, 'i'));
  return compactText(match?.[0] || '');
}

export async function scrapeRealWorkFromAnywhereJobs(config, siteConfig = {}) {
  return new RealWorkFromAnywhereScraper(config, siteConfig).scrape();
}

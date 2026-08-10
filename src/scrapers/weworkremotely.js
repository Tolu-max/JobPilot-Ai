import { BaseScraper } from './baseScraper.js';
import { compactText, stripHtml } from '../utils.js';
import { extractApplyUrlFromHtml, matchesGatewayJobPolicy, parseSimpleRss } from './gatewaySourceHelpers.js';

const LISTING_URL = 'https://weworkremotely.com/remote-jobs.rss';
const DEFAULT_FEEDS = [
  'https://weworkremotely.com/categories/remote-customer-support-jobs.rss',
  'https://weworkremotely.com/remote-jobs.rss'
];
const SAME_HOST_PATTERNS = [/weworkremotely\.com/i];

export class WeWorkRemotelyScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('weworkremotely', config, siteConfig);
  }

  async fetchJobs() {
    const feeds = this.siteConfig.feedUrls || this.siteConfig.feeds || DEFAULT_FEEDS;
    const targets = Array.isArray(feeds) ? feeds : [feeds];
    const listings = [];
    for (const feedUrl of targets) {
      const xml = await this.fetchText(feedUrl);
      listings.push(...parseListingLinks(xml, feedUrl));
    }
    const limit = this.resolveMaxJobsPerRun();
    return listings.slice(0, limit > 0 ? limit : 25);
  }

  normalizeJob(rawJob) {
    return super.normalizeJob({
      source: 'weworkremotely',
      source_site: 'weworkremotely',
      sourceJobId: rawJob.sourceJobId || slugId(rawJob.jobUrl || rawJob.applicationUrl),
      title: rawJob.title,
      company: rawJob.company,
      location: rawJob.location || 'Remote',
      description: rawJob.description,
      requirements: rawJob.requirements,
      responsibilities: rawJob.responsibilities,
      tags: rawJob.tags,
      requiredSkills: rawJob.requiredSkills,
      applicationUrl: rawJob.applicationUrl || rawJob.jobUrl,
      postedAt: rawJob.postedAt,
      raw: rawJob
    });
  }

  matchesSitePolicy(job) {
    if (!super.matchesSitePolicy(job)) return false;
    return matchesGatewayJobPolicy(job, this.siteConfig);
  }
}

export function parseListingLinks(xml, pageUrl = LISTING_URL) {
  return parseSimpleRss(xml).map((item) => {
    const [company, title] = splitTitle(item.title);
    const description = compactText(stripHtml(item.description || ''));
    const feedApplyUrl = extractApplyUrlFromHtml(item.description || '', {
      sameHostPatterns: SAME_HOST_PATTERNS,
      pageUrl: item.link || pageUrl
    });
    return {
      jobUrl: item.link,
      applicationUrl: feedApplyUrl || item.link,
      title: title || item.title,
      company,
      text: description,
      location: compactText(extractXmlTag(item, 'region') || extractXmlTag(item, 'country') || 'Remote'),
      postedAt: item.pubDate,
      description,
      tags: [extractXmlTag(item, 'category'), extractXmlTag(item, 'type')].filter(Boolean)
    };
  }).filter((item) => item.jobUrl);
}

export function parseJobDetail(html, listing = {}) {
  if (/just a moment/i.test(String(html || ''))) return listing;
  const title = compactText(
    extractMeta(html, 'og:title') ||
    extractTagText(html, 'title').replace(/\s*\|\s*We Work Remotely\s*$/i, '') ||
    listing.title
  );
  const company = compactText(
    extractMeta(html, 'og:site_name') && listing.company ? listing.company : listing.company || inferCompanyFromTitle(title)
  );
  const description = compactText(stripHtml(extractMeta(html, 'description') || extractSection(html)));
  const requirements = compactText(extractSegment(description, /(requirements|qualifications|what you(?:'|’)?ll bring)/i));
  const responsibilities = compactText(extractSegment(description, /(responsibilities|what you(?:'|’)?ll do|about the role)/i));
  const postedAt = compactText(extractLabelValue(html, 'Posted') || extractTime(html));
  const location = compactText(extractLabelValue(html, 'Location') || inferLocation(description) || 'Remote');
  const applicationUrl = extractApplyUrlFromHtml(html, { sameHostPatterns: SAME_HOST_PATTERNS, pageUrl: listing.jobUrl || LISTING_URL }) || listing.jobUrl;

  return {
    ...listing,
    title,
    company,
    location,
    description,
    requirements,
    responsibilities,
    applicationUrl,
    postedAt,
    tags: [location].filter(Boolean)
  };
}

function splitTitle(value) {
  const match = String(value || '').split(':');
  if (match.length < 2) return ['', compactText(value)];
  return [compactText(match[0]), compactText(match.slice(1).join(':'))];
}

function extractXmlTag(item, tagName) {
  const raw = item?.rawXml || '';
  const match = String(raw).match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return compactText(stripHtml(match?.[1] || ''));
}

function extractMeta(html, property) {
  const match = String(html || '').match(new RegExp(`<meta[^>]+(?:property|name)="${property}"[^>]+content="([^"]+)"`, 'i'));
  return match?.[1] || '';
}

function extractTagText(html, tagName) {
  const match = String(html || '').match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return compactText(stripHtml(match?.[1] || ''));
}

function extractSection(html) {
  const match = String(html || '').match(/<section[^>]+class="[^"]*listing-container[^"]*"[\s\S]*?<\/section>/i)
    || String(html || '').match(/<article[\s\S]*?<\/article>/i);
  return match?.[0] || html;
}

function extractSegment(text, marker) {
  const value = String(text || '');
  const match = value.match(new RegExp(`${marker.source}[\\s\\S]{0,1000}`, 'i'));
  return match?.[0] || '';
}

function extractLabelValue(html, label) {
  const match = String(html || '').match(new RegExp(`${label}<\\/[^>]+>\\s*<[^>]+>([\\s\\S]{0,160}?)<\\/[^>]+>`, 'i'));
  return compactText(stripHtml(match?.[1] || ''));
}

function extractTime(html) {
  const match = String(html || '').match(/<time[^>]+datetime="([^"]+)"/i) || String(html || '').match(/<time[^>]*>([\s\S]*?)<\/time>/i);
  return compactText(match?.[1] || '');
}

function inferLocation(text) {
  const match = String(text || '').match(/\b(remote|worldwide|anywhere|global|emea|europe|uk|us|canada)\b/i);
  return match?.[0] ? match[0].replace(/\b\w/g, (char) => char.toUpperCase()) : '';
}

function inferCompanyFromTitle(title) {
  return compactText(String(title || '').split(':')[0]);
}

function slugId(url) {
  return String(url || '').split('/').filter(Boolean).pop() || '';
}

function absolutize(value, pageUrl) {
  try {
    return new URL(value, pageUrl).href;
  } catch {
    return '';
  }
}

export async function scrapeWeWorkRemotelyJobs(config, siteConfig = {}) {
  return new WeWorkRemotelyScraper(config, siteConfig).scrape();
}

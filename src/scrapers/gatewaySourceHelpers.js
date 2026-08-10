import { compactText, stripHtml } from '../utils.js';
import { normalizeList } from './baseScraper.js';

const DEFAULT_MAX_AGE_DAYS = 14;
const DEFAULT_RESTRICTED_COUNTRIES = /\b(US|USA|United States|Canada|UK|United Kingdom|India|Australia|New Zealand|EU|Europe)\b/i;
const DEFAULT_REMOTE_PATTERN = /\b(remote|work from home|home based|home-based|distributed|telecommute|telecommuting|worldwide|anywhere|global|international|fully remote)\b/i;
export function matchesGatewayJobPolicy(job, siteConfig = {}) {
  const maxAgeDays = Number.parseInt(siteConfig.maxAgeDays, 10) || DEFAULT_MAX_AGE_DAYS;
  if (!isRecent(job.postedAt, maxAgeDays)) return false;

  if (siteConfig.remoteOnly !== false && !isRemoteJob(job, siteConfig)) return false;
  if (!matchesLocationPolicy(job, siteConfig)) return false;
  if (hasExcludedSeniority(job, siteConfig)) return false;

  return true;
}

export function isRecent(postedAt, maxAgeDays = DEFAULT_MAX_AGE_DAYS) {
  if (!postedAt) return true;
  const posted = new Date(postedAt).getTime();
  if (!Number.isFinite(posted)) return true;
  return Date.now() - posted <= maxAgeDays * 24 * 60 * 60 * 1000;
}

export function isRemoteJob(job, siteConfig = {}) {
  const remotePattern = siteConfig.remotePattern ? new RegExp(siteConfig.remotePattern, 'i') : DEFAULT_REMOTE_PATTERN;
  const text = [
    job.location,
    job.title,
    job.description,
    job.requirements,
    job.raw?.location,
    job.raw?.candidate_required_location,
    job.raw?.jobGeo,
    job.raw?.jobLocationType,
    job.raw?.region,
    job.raw?.category_name
  ].filter(Boolean).join(' ');

  return remotePattern.test(text);
}

export function matchesLocationPolicy(job, siteConfig = {}) {
  const preferred = normalizeList(siteConfig.preferredLocations || siteConfig.allowedLocations || siteConfig.country);
  if (!preferred.length) return true;

  const locationText = [
    job.location,
    job.raw?.location,
    job.raw?.candidate_required_location,
    job.raw?.jobGeo,
    job.raw?.locations?.map?.((item) => item?.name || item).join(' '),
    job.raw?.regions?.map?.((item) => item?.name || item).join(' '),
    job.raw?.country,
    job.raw?.jobLocation?.address?.addressCountry
  ].filter(Boolean).join(' ');

  const preferredPattern = new RegExp(preferred.map(escapeRegExp).join('|'), 'i');
  if (preferredPattern.test(locationText)) return true;
  if (DEFAULT_REMOTE_PATTERN.test(locationText)) return true;
  if (DEFAULT_RESTRICTED_COUNTRIES.test(locationText)) return false;

  return siteConfig.allowOtherLocationsWhenNoPreferred === true;
}

export function extractApplyUrlFromHtml(html, {
  sameHostPatterns = [],
  pageUrl = ''
} = {}) {
  const candidates = [];
  const text = String(html || '');
  const linkPattern = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/ig;
  let match;

  while ((match = linkPattern.exec(text))) {
    const href = decodeEntities(match[1]);
    const label = compactText(stripHtml(match[2])).toLowerCase();
    if (!href || href.startsWith('#')) continue;
    if (!/apply|job|career|position|opening|company site|external/i.test(`${href} ${label}`)) continue;
    candidates.push({ href, label });
  }

  for (const candidate of candidates) {
    const absolute = absolutizeUrl(candidate.href, pageUrl);
    if (!absolute) continue;
    if (sameHostPatterns.some((pattern) => pattern.test(absolute))) continue;
    return absolute;
  }

  return '';
}

export function parseSimpleRss(xml) {
  const text = String(xml || '');
  const items = [];
  const itemPattern = /<item\b[\s\S]*?<\/item>/ig;
  let match;

  while ((match = itemPattern.exec(text))) {
    const block = match[0];
    items.push({
      title: decodeXmlField(extractTag(block, 'title')),
      link: decodeXmlField(extractTag(block, 'link')),
      description: decodeXmlField(extractTag(block, 'description')),
      pubDate: decodeXmlField(extractTag(block, 'pubDate')),
      guid: decodeXmlField(extractTag(block, 'guid')),
      category: extractAllTags(block, 'category').map(decodeXmlField),
      rawXml: block
    });
  }

  return items;
}

function extractTag(block, tagName) {
  const match = String(block || '').match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match?.[1] || '';
}

function extractAllTags(block, tagName) {
  return [...String(block || '').matchAll(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'ig'))].map((match) => match[1]);
}

function decodeXmlField(value) {
  return decodeEntities(String(value || '').replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/i, '$1'));
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function absolutizeUrl(value, pageUrl = '') {
  try {
    return new URL(value, pageUrl || 'https://example.com').href;
  } catch {
    return '';
  }
}

function hasExcludedSeniority(job, siteConfig = {}) {
  const excluded = normalizeList(siteConfig.excludedTitleKeywords);
  if (!excluded.length) return false;
  const title = String(job.title || '').toLowerCase();
  return excluded.some((keyword) => title.includes(String(keyword).toLowerCase()));
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

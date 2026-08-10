import crypto from 'node:crypto';
import { compactText } from './utils.js';

export function createJobHash(job = {}) {
  const source = normalizeKey(job.source_site || job.source || 'unknown');
  const sourceJobId = normalizeKey(job.sourceJobId || job.externalId || job.id);
  const url = normalizeUrl(job.applicationUrl || job.job_url || job.url || '');
  const title = normalizeKey(job.title || '');
  const company = normalizeKey(job.company || '');

  let stableKey = `${source}|title:${title}|company:${company}`;
  if (url) {
    stableKey = `${source}|url:${url}`;
  } else if (sourceJobId) {
    stableKey = `${source}|id:${sourceJobId}`;
  } else if (title && company) {
    stableKey = `title:${title}|company:${company}`;
  }

  return crypto.createHash('sha256').update(stableKey).digest('hex');
}

export function normalizeUrl(value) {
  const raw = compactText(value);
  if (!raw) return '';

  try {
    const url = new URL(raw);
    url.hash = '';
    const removableParams = [
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'ref',
      'source'
    ];
    for (const param of removableParams) {
      url.searchParams.delete(param);
    }
    url.hostname = url.hostname.toLowerCase();
    // Normalize BruntWork apply URLs to the job detail URL so already-applied records still dedupe.
    if (/bruntwork(careers)?\.co$/i.test(url.hostname)) {
      url.pathname = url.pathname.replace(/^(\/jobs\/\d+)\/apply\/?$/i, '$1');
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw.replace(/\/$/, '');
  }
}

function normalizeKey(value) {
  return compactText(value).toLowerCase();
}

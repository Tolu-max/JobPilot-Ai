import { BaseScraper, normalizeList } from './baseScraper.js';
import { isRecent, matchesGatewayJobPolicy } from './gatewaySourceHelpers.js';
import { compactText, stripHtml } from '../utils.js';

const DEFAULT_BOARDS = [
  '20four7va',
  'softab',
  'erbis',
  'snappycx',
  'betterme',
  'freeup',
  'ourassistants',
  'zinier',
  'pairty',
  'grove',
  'bloom',
  'cortex',
  'spark',
  'bold'
];

export class BreezyHrScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('breezyhr', config, siteConfig);
  }

  async fetchJobs() {
    const boards = resolveBoards(this.siteConfig);
    const results = [];

    for (const board of boards) {
      try {
        const endpoint = board.apiUrl || `https://${encodeURIComponent(board.token)}.breezy.hr/json`;
        const payload = await this.fetchJson(endpoint);
        const jobs = Array.isArray(payload) ? payload : [];

        for (const job of jobs) {
          results.push({
            ...job,
            _breezyBoard: board
          });
        }
      } catch (error) {
        await this.log(`Breezy HR board "${board.token}" failed: ${error.message}`);
      }
    }

    const limit = this.resolveMaxJobsPerRun();
    const scanLimit = limit > 0 ? Math.max(limit * 2, 25) : 25;
    const toEnrich = results.slice(0, scanLimit);
    const jobs = [];

    for (const item of toEnrich) {
      let description = '';
      if (item.url) {
        try {
          const detailHtml = await this.fetchText(item.url, { timeoutMs: 8000 });
          description = extractDescriptionFromHtml(detailHtml);
        } catch {
          // Description fallback handled in normalizeJob
        }
      }
      jobs.push({
        ...item,
        _descriptionHtml: description
      });
    }

    return jobs;
  }

  normalizeJob(rawJob) {
    const board = rawJob._breezyBoard || {};
    const title = compactText(rawJob.name || rawJob.title);
    const locObj = rawJob.location || {};
    const locName = compactText(locObj.name || [locObj.city, locObj.state?.name, locObj.country?.name].filter(Boolean).join(', '));
    const isRemote = Boolean(locObj.is_remote || /remote/i.test(locName) || /remote/i.test(title));
    const location = locName || (isRemote ? 'Remote' : 'Remote');
    const jobType = compactText(rawJob.type?.name || rawJob.type?.id || rawJob.type || 'Full-Time');
    const company = compactText(rawJob.company?.name || board.company || board.name || board.token);
    const friendlyId = rawJob.friendly_id || rawJob.id;
    const applyUrl = rawJob.url ? (rawJob.url.endsWith('/apply') ? rawJob.url : `${rawJob.url}/apply`) : `https://${board.token}.breezy.hr/p/${friendlyId}/apply`;
    const description = compactText(rawJob._descriptionHtml || rawJob.description || title);

    const tags = [
      rawJob.department,
      jobType,
      isRemote ? 'Remote' : ''
    ].filter(Boolean).map(compactText);

    return super.normalizeJob({
      source: 'breezyhr',
      source_site: 'breezyhr',
      sourceJobId: String(rawJob.id || friendlyId),
      title,
      company,
      location,
      jobType,
      salary: compactText(rawJob.salary || ''),
      description,
      requirements: description,
      tags,
      requiredSkills: tags,
      applicationUrl: applyUrl,
      postedAt: rawJob.published_date || new Date().toISOString(),
      is_remote: isRemote,
      raw: {
        ...rawJob,
        boardToken: board.token,
        boardCompany: company,
        jobUrl: rawJob.url || `https://${board.token}.breezy.hr/p/${friendlyId}`,
        applyUrl
      }
    });
  }

  matchesSitePolicy(job) {
    if (!super.matchesSitePolicy(job)) return false;

    const maxAgeDays = Number.parseInt(this.siteConfig.maxAgeDays, 10);
    if (Number.isFinite(maxAgeDays) && maxAgeDays > 0 && !isRecent(job.postedAt, maxAgeDays)) return false;

    const requiredTitleKeywords = normalizeList(this.siteConfig.requireTitleKeywords);
    if (requiredTitleKeywords.length) {
      const title = String(job.title || '').toLowerCase();
      if (!requiredTitleKeywords.some((keyword) => title.includes(keyword.toLowerCase()))) return false;
    }

    if (this.siteConfig.remoteOnly) {
      const location = String(job.location || '').toLowerCase();
      const text = `${job.title || ''} ${job.description || ''}`.toLowerCase();
      const remotePattern = /\b(remote|home based|home-based|anywhere|distributed|emea|global|worldwide|work from home)\b/;
      if (location && !remotePattern.test(location)) return false;
      if (!location && !remotePattern.test(text)) return false;
    }

    return matchesGatewayJobPolicy(job, this.siteConfig);
  }
}

export function resolveBoards(siteConfig = {}) {
  const configured = siteConfig.boards || siteConfig.boardTokens || siteConfig.tokens || DEFAULT_BOARDS;
  const list = Array.isArray(configured) ? configured : String(configured).split(/[\s,]+/);

  return list
    .map((entry) => normalizeBoard(entry))
    .filter((board) => board.token || board.apiUrl);
}

function normalizeBoard(entry) {
  if (typeof entry === 'object' && entry !== null) {
    const token = compactText(entry.token || entry.boardToken || entry.slug || entry.name);
    return {
      token: normalizeBoardToken(token),
      name: compactText(entry.name || entry.company || token),
      company: compactText(entry.company || entry.name || token),
      apiUrl: compactText(entry.apiUrl || entry.url)
    };
  }

  const raw = compactText(entry);
  return {
    token: normalizeBoardToken(raw),
    name: raw,
    company: raw,
    apiUrl: ''
  };
}

export function normalizeBoardToken(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/([^.]+)\.breezy\.hr.*/i, '$1')
    .replace(/[^a-zA-Z0-9_-]+/g, '')
    .toLowerCase();
}

export function extractDescriptionFromHtml(html = '') {
  const match = String(html || '').match(/<div\b[^>]*class=["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/i)
    || String(html || '').match(/<div\b[^>]*class=["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  return match ? compactText(stripHtml(match[1])) : '';
}

export async function scrapeBreezyHrJobs(config, siteConfig = {}) {
  return new BreezyHrScraper(config, siteConfig).scrape();
}

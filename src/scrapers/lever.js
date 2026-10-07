import { BaseScraper, normalizeList } from './baseScraper.js';
import { isRecent } from './gatewaySourceHelpers.js';
import { compactText, stripHtml } from '../utils.js';

const DEFAULT_BOARDS = [
  '10up-2',
  'kinsta',
  'helpscout',
  'remote',
  'canonical',
  '15five',
  '360learning',
  'sonarsource',
  'palantir'
];

export class LeverScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('lever', config, siteConfig);
  }

  async fetchJobs() {
    const boards = resolveBoards(this.siteConfig);
    const results = [];

    for (const board of boards) {
      try {
        const endpoint = board.apiUrl || `https://api.lever.co/v0/postings/${encodeURIComponent(board.token)}?mode=json`;
        const payload = await this.fetchJson(endpoint);
        const jobs = Array.isArray(payload) ? payload : [];
        results.push(...jobs.map((job) => ({ ...job, _leverBoard: board })));
      } catch (error) {
        await this.log(`Lever board "${board.token}" failed: ${error.message}`);
      }
    }

    return results;
  }

  normalizeJob(rawJob) {
    const board = rawJob._leverBoard || {};
    const categories = rawJob.categories || {};
    const location = compactText(categories.location || 'Remote');
    const description = compactText(rawJob.descriptionPlain || stripHtml(rawJob.description || ''));
    const title = compactText(rawJob.text || rawJob.title);
    const applicationUrl = compactText(rawJob.applyUrl || rawJob.hostedUrl);

    return super.normalizeJob({
      source: 'lever',
      source_site: 'lever',
      sourceJobId: rawJob.id,
      title,
      company: board.company || board.name || board.token,
      location,
      jobType: compactText(categories.commitment || ''),
      description,
      requirements: description,
      tags: [categories.team, categories.department, categories.allLocations].flat().filter(Boolean).map(compactText),
      applicationUrl,
      postedAt: rawJob.createdAt ? new Date(rawJob.createdAt).toISOString() : new Date().toISOString(),
      raw: {
        ...rawJob,
        boardToken: board.token,
        boardCompany: board.company || board.name || ''
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

    return true;
  }
}

function resolveBoards(siteConfig = {}) {
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

function normalizeBoardToken(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/jobs\.lever\.co\/([^/]+).*/i, '$1')
    .replace(/[^a-zA-Z0-9_-]+/g, '')
    .toLowerCase();
}

export async function scrapeLeverJobs(config, siteConfig = {}) {
  return new LeverScraper(config, siteConfig).scrape();
}

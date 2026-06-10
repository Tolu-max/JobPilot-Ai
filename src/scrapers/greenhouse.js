import { BaseScraper, normalizeList } from './baseScraper.js';
import { compactText, stripHtml } from '../utils.js';

const DEFAULT_BOARDS = [
  'zapier',
  'automattic',
  'doist',
  'buffer',
  'gitlab',
  'hotjar',
  'remote',
  'toggl',
  'clickup',
  'webflow'
];

export class GreenhouseScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('greenhouse', config, siteConfig);
  }

  async fetchJobs() {
    const boards = resolveBoards(this.siteConfig);
    const results = [];

    for (const board of boards) {
      try {
        const endpoint = board.apiUrl || `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board.token)}/jobs?content=true`;
        const payload = await this.fetchJson(endpoint);
        const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
        results.push(...jobs.map((job) => ({ ...job, _greenhouseBoard: board })));
      } catch (error) {
        await this.log(`Board "${board.token}" failed: ${error.message}`);
      }
    }

    return results;
  }

  normalizeJob(rawJob) {
    const board = rawJob._greenhouseBoard || {};
    const offices = normalizeGreenhouseNames(rawJob.offices);
    const departments = normalizeGreenhouseNames(rawJob.departments);
    const location = compactText(rawJob.location?.name || offices.join(', ') || 'Remote');
    const content = stripHtml(rawJob.content || rawJob.description || '');

    return super.normalizeJob({
      source: 'greenhouse',
      source_site: 'greenhouse',
      sourceJobId: rawJob.id,
      title: rawJob.title,
      company: board.company || board.name || board.token,
      location,
      jobType: rawJob.metadata?.employment_type || '',
      description: content,
      requirements: extractRequirements(content),
      tags: [...departments, ...offices].filter(Boolean),
      keywords: [...departments, ...offices].filter(Boolean),
      applicationUrl: greenhouseApplicationUrl(rawJob, board),
      postedAt: rawJob.updated_at || rawJob.created_at,
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
    .replace(/^https?:\/\/boards-api\.greenhouse\.io\/v1\/boards\/([^/]+).*/i, '$1')
    .replace(/^https?:\/\/boards\.greenhouse\.io\/([^/]+).*/i, '$1')
    .replace(/[^a-zA-Z0-9_-]+/g, '')
    .toLowerCase();
}

function normalizeGreenhouseNames(items) {
  return Array.isArray(items)
    ? items.map((item) => compactText(item?.name || item)).filter(Boolean)
    : [];
}

function greenhouseApplicationUrl(rawJob, board) {
  const absolute = compactText(rawJob.absolute_url || rawJob.url);
  if (/(?:boards|job-boards)\.greenhouse\.io/i.test(absolute)) return absolute;
  if (board?.token && rawJob.id) return `https://job-boards.greenhouse.io/${board.token}/jobs/${rawJob.id}`;
  return absolute;
}

function extractRequirements(text) {
  const value = String(text || '');
  const match = value.match(/(?:requirements|qualifications|what you(?:'|’)ll bring|you have)([\s\S]{0,1800})/i);
  return compactText(match?.[0] || '');
}

function isRecent(postedAt, maxAgeDays) {
  if (!postedAt) return true;
  const posted = new Date(postedAt).getTime();
  if (!Number.isFinite(posted)) return true;
  return Date.now() - posted <= maxAgeDays * 24 * 60 * 60 * 1000;
}

export async function scrapeGreenhouseJobs(config, siteConfig = {}) {
  return new GreenhouseScraper(config, siteConfig).scrape();
}

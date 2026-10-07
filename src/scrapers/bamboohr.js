import { BaseScraper, normalizeList } from './baseScraper.js';
import { isRecent } from './gatewaySourceHelpers.js';
import { compactText, stripHtml } from '../utils.js';

const DEFAULT_BOARDS = [
  '10web',
  'raenest',
  'engenious',
  'kencko',
  'accessnow',
  'wavefrontsoftware',
  'benchmark',
  'lemonio'
];

export class BambooHRScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('bamboohr', config, siteConfig);
  }

  async fetchJobs() {
    const boards = resolveBoards(this.siteConfig);
    const results = [];

    for (const board of boards) {
      try {
        const listEndpoint = board.apiUrl || `https://${encodeURIComponent(board.token)}.bamboohr.com/careers/list`;
        const payload = await this.fetchJson(listEndpoint);
        const jobs = Array.isArray(payload?.result) ? payload.result : [];

        for (const job of jobs) {
          let detail = null;
          try {
            const detailUrl = `https://${encodeURIComponent(board.token)}.bamboohr.com/careers/${encodeURIComponent(job.id)}/detail`;
            const detailPayload = await this.fetchJson(detailUrl, { timeoutMs: 10000 });
            detail = detailPayload?.result || null;
          } catch {
            // detail is optional enhancement; fallback to listing fields
          }

          results.push({
            ...job,
            _detail: detail,
            _bambooBoard: board
          });
        }
      } catch (error) {
        await this.log(`BambooHR board "${board.token}" failed: ${error.message}`);
      }
    }

    return results;
  }

  normalizeJob(rawJob) {
    const board = rawJob._bambooBoard || {};
    const detail = rawJob._detail?.jobOpening || {};
    const title = compactText(detail.jobOpeningName || rawJob.jobOpeningName || rawJob.title);
    const descHtml = detail.description || detail.jobDescription || rawJob.description || '';
    const description = compactText(stripHtml(descHtml));

    const locObj = detail.location || rawJob.location || {};
    const locParts = [locObj.city, locObj.state, locObj.country].filter(Boolean);
    const location = locParts.length ? locParts.join(', ') : (rawJob.isRemote ? 'Remote' : 'Remote');

    const department = detail.departmentLabel || rawJob.departmentLabel || '';
    const employmentStatus = detail.employmentStatusLabel || rawJob.employmentStatusLabel || '';
    const applicationUrl = `https://${board.token}.bamboohr.com/careers/${rawJob.id}`;

    return super.normalizeJob({
      source: 'bamboohr',
      source_site: 'bamboohr',
      sourceJobId: String(rawJob.id),
      title,
      company: board.company || board.name || board.token,
      location,
      jobType: employmentStatus,
      description,
      requirements: description,
      tags: [department, employmentStatus].filter(Boolean),
      applicationUrl,
      postedAt: detail.datePosted || rawJob.datePosted || new Date().toISOString(),
      is_remote: Boolean(rawJob.isRemote || /remote/i.test(location) || /remote/i.test(title)),
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
    .replace(/^https?:\/\/([^.]+)\.bamboohr\.com.*/i, '$1')
    .replace(/[^a-zA-Z0-9_-]+/g, '')
    .toLowerCase();
}

export async function scrapeBambooHRJobs(config, siteConfig = {}) {
  return new BambooHRScraper(config, siteConfig).scrape();
}

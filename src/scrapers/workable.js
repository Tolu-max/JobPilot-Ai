import { BaseScraper, normalizeList } from './baseScraper.js';
import { isRecent, matchesGatewayJobPolicy } from './gatewaySourceHelpers.js';
import { compactText, stripHtml } from '../utils.js';

const DEFAULT_BOARDS = [
  'kobotoolbox',
  'wati',
  'smartlogic',
  'supportyourapp',
  'brandbastion',
  'reliancehealth',
  'huzzle',
  'nogigiddy',
  'driftrock',
  'epignosis',
  'treatwell',
  'skroutz',
  'blueground',
  'taxjar',
  'pleo',
  'unbabel'
];

export class WorkableScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('workable', config, siteConfig);
  }

  async fetchJobs() {
    const boards = resolveBoards(this.siteConfig);
    const results = [];

    for (const board of boards) {
      try {
        const endpoint = board.apiUrl || `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(board.token)}?details=true`;
        const payload = await this.fetchJson(endpoint);
        const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
        const accountName = compactText(payload?.name || board.name || board.token);

        for (const job of jobs) {
          results.push({
            ...job,
            _workableBoard: board,
            _accountName: accountName
          });
        }
      } catch (error) {
        await this.log(`Workable board "${board.token}" failed: ${error.message}`);
      }
    }

    const limit = this.resolveMaxJobsPerRun();
    const scanLimit = limit > 0 ? Math.max(limit * 2, 25) : 25;
    return results.slice(0, scanLimit);
  }

  normalizeJob(rawJob) {
    const board = rawJob._workableBoard || {};
    const title = compactText(rawJob.title || rawJob.name);
    const locParts = [
      rawJob.city,
      rawJob.state,
      rawJob.country
    ].filter(Boolean);
    const locName = compactText(locParts.join(', '));
    const isRemote = Boolean(rawJob.telecommuting || /remote/i.test(locName) || /remote/i.test(title));
    const location = locName || (isRemote ? 'Remote' : 'Remote');
    const jobType = compactText(rawJob.employment_type || 'Full-time');
    const company = compactText(rawJob._accountName || rawJob.company || board.company || board.name || board.token);
    const friendlyId = rawJob.shortcode || rawJob.code || rawJob.id;
    const applyUrl = rawJob.application_url || (friendlyId ? `https://apply.workable.com/j/${friendlyId}/apply` : rawJob.url || '');
    const cleanDesc = compactText(stripHtml(rawJob.description || '')) || title;
    const requirements = extractRequirements(rawJob.description) || cleanDesc;

    const tags = [
      rawJob.department,
      rawJob.function,
      jobType,
      isRemote ? 'Remote' : ''
    ].filter(Boolean).map(compactText);

    return super.normalizeJob({
      source: 'workable',
      source_site: 'workable',
      sourceJobId: String(friendlyId),
      title,
      company,
      location,
      jobType,
      salary: compactText(rawJob.salary || ''),
      description: cleanDesc,
      requirements,
      tags,
      requiredSkills: tags,
      applicationUrl: applyUrl,
      postedAt: rawJob.published_on || rawJob.created_at || new Date().toISOString(),
      is_remote: isRemote,
      raw: {
        ...rawJob,
        boardToken: board.token,
        boardCompany: company,
        jobUrl: rawJob.url || applyUrl,
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
  const configured = siteConfig.boards || siteConfig.boardTokens || siteConfig.accounts || DEFAULT_BOARDS;
  const list = Array.isArray(configured) ? configured : String(configured).split(/[\s,]+/);

  return list
    .map((entry) => normalizeBoard(entry))
    .filter((board) => board.token || board.apiUrl);
}

function normalizeBoard(entry) {
  if (typeof entry === 'object' && entry !== null) {
    const token = compactText(entry.token || entry.boardToken || entry.slug || entry.name || entry.account);
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
    .replace(/^https?:\/\/apply\.workable\.com\/([^/]+).*/i, '$1')
    .replace(/^https?:\/\/([^.]+)\.workable\.com.*/i, '$1')
    .replace(/[^a-zA-Z0-9_-]+/g, '')
    .toLowerCase();
}

export function extractRequirements(html = '') {
  if (!html) return '';
  const match = String(html).match(/<strong>\s*Requirements\s*<\/strong>([\s\S]*?)(?:<strong>\s*Benefits|<strong>\s*About|$)/i)
    || String(html).match(/<h2>\s*Requirements\s*<\/h2>([\s\S]*?)(?:<h2>\s*Benefits|<h2>\s*About|$)/i);
  return match ? compactText(stripHtml(match[1])) : '';
}

export async function scrapeWorkableJobs(config, siteConfig = {}) {
  return new WorkableScraper(config, siteConfig).scrape();
}

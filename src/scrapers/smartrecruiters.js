import { BaseScraper, normalizeList } from './baseScraper.js';
import { isRecent, matchesGatewayJobPolicy } from './gatewaySourceHelpers.js';
import { compactText, stripHtml } from '../utils.js';

const DEFAULT_BOARDS = [
  'canva',
  'opsway',
  'fygaro',
  'credativ',
  'jobsforhumanity',
  'SmartRecruiters',
  'Wise',
  'DeliveryHero',
  'BoschGroup',
  'Ubisoft2',
  'Colliers'
];

export class SmartRecruitersScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('smartrecruiters', config, siteConfig);
  }

  async fetchJobs() {
    const boards = resolveBoards(this.siteConfig);
    const results = [];

    for (const board of boards) {
      try {
        const endpoint = board.apiUrl || `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(board.token)}/postings?limit=100`;
        const payload = await this.fetchJson(endpoint);
        const postings = Array.isArray(payload?.content) ? payload.content : [];

        for (const posting of postings) {
          results.push({
            ...posting,
            _smartRecruitersBoard: board
          });
        }
      } catch (error) {
        await this.log(`SmartRecruiters board "${board.token}" failed: ${error.message}`);
      }
    }

    const limit = this.resolveMaxJobsPerRun();
    const scanLimit = limit > 0 ? Math.max(limit * 2, 25) : 25;
    const toEnrich = results.slice(0, scanLimit);
    const jobs = [];

    for (const item of toEnrich) {
      let detail = null;
      const board = item._smartRecruitersBoard || {};
      const companyToken = board.token || item.company?.identifier;
      if (companyToken && item.id) {
        const detailUrl = item.ref || `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyToken)}/postings/${encodeURIComponent(item.id)}`;
        try {
          detail = await this.fetchJson(detailUrl, { timeoutMs: 8000 });
        } catch (error) {
          // Fall back to listing data, but retain enough context to diagnose
          // board-specific timeouts without turning one bad detail into a run failure.
          await this.log(`Detail skipped for board "${companyToken}" posting "${item.id}": ${error.message}`);
        }
      }

      const sections = detail?.jobAd?.sections || {};
      jobs.push({
        ...item,
        ...(detail || {}),
        _smartRecruitersBoard: board,
        _descriptionHtml: sections.jobDescription?.text || '',
        _qualificationsHtml: sections.qualifications?.text || '',
        _additionalInfoHtml: sections.additionalInformation?.text || '',
        _companyDescriptionHtml: sections.companyDescription?.text || ''
      });
    }

    return jobs;
  }

  normalizeJob(rawJob) {
    const board = rawJob._smartRecruitersBoard || {};
    const title = compactText(rawJob.name || rawJob.title);
    const locObj = rawJob.location || {};
    const locName = compactText(locObj.fullLocation || [locObj.city, locObj.region, locObj.country].filter(Boolean).join(', '));
    const isRemote = Boolean(locObj.remote || /remote/i.test(locName) || /remote/i.test(title));
    const location = locName || (isRemote ? 'Remote' : 'Remote');
    const jobType = compactText(rawJob.typeOfEmployment?.label || rawJob.typeOfEmployment?.id || 'Full-Time');
    const company = compactText(rawJob.company?.name || board.company || board.name || board.token);
    const friendlyId = rawJob.id || rawJob.uuid;
    const companySlug = board.token || rawJob.company?.identifier || 'smartrecruiters';
    const applyUrl = rawJob.applyUrl || rawJob.postingUrl || (friendlyId ? `https://jobs.smartrecruiters.com/${companySlug}/${friendlyId}` : '');

    const descParts = [
      rawJob._descriptionHtml,
      rawJob._qualificationsHtml,
      rawJob._additionalInfoHtml,
      rawJob.description
    ].filter(Boolean);

    const description = compactText(stripHtml(descParts.join('\n\n'))) || title;
    const requirements = compactText(stripHtml(rawJob._qualificationsHtml || '')) || description;

    const tags = [
      rawJob.department?.label,
      rawJob.function?.label,
      rawJob.industry?.label,
      jobType,
      isRemote ? 'Remote' : ''
    ].filter(Boolean).map(compactText);

    return super.normalizeJob({
      source: 'smartrecruiters',
      source_site: 'smartrecruiters',
      sourceJobId: String(friendlyId),
      title,
      company,
      location,
      jobType,
      salary: '',
      description,
      requirements,
      tags,
      requiredSkills: tags,
      applicationUrl: applyUrl,
      postedAt: rawJob.releasedDate || new Date().toISOString(),
      is_remote: isRemote,
      raw: {
        ...rawJob,
        boardToken: board.token,
        boardCompany: company,
        jobUrl: rawJob.postingUrl || applyUrl,
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
  const configured = siteConfig.boards || siteConfig.boardTokens || siteConfig.companies || DEFAULT_BOARDS;
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
    .replace(/^https?:\/\/(?:careers|jobs)\.smartrecruiters\.com\/([^/]+).*/i, '$1')
    .replace(/[^a-zA-Z0-9_-]+/g, '');
}

export async function scrapeSmartRecruitersJobs(config, siteConfig = {}) {
  return new SmartRecruitersScraper(config, siteConfig).scrape();
}

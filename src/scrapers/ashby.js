import { BaseScraper, normalizeList } from './baseScraper.js';
import { isRecent } from './gatewaySourceHelpers.js';
import { compactText, stripHtml } from '../utils.js';

const DEFAULT_BOARDS = [
  'Scale Army Careers',
  'hostinger',
  'tempo',
  'moab',
  'jiga',
  'hopper',
  'cursor',
  'elevenlabs',
  'perplexity',
  'ramp',
  'vanta',
  'linear',
  'n8n',
  'firecrawl',
  'openrouter',
  'posthog',
  'close.com',
  'supabase',
  'replit',
  'sentry',
  'render',
  'temporal',
  'resend',
  'zapier',
  'modal'
];

export class AshbyScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('ashby', config, siteConfig);
  }

  async fetchJobs() {
    const configured = this.siteConfig.boards || this.siteConfig.boardTokens || DEFAULT_BOARDS;
    const boards = Array.isArray(configured) ? configured : String(configured).split(/[\s,]+/);
    const allJobs = [];

    for (const board of boards) {
      if (!board) continue;
      const endpoint = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;
      try {
        const payload = await this.fetchJson(endpoint);
        const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
        
        jobs.forEach((job) => {
          job._board = board;
        });

        allJobs.push(...jobs);
      } catch (err) {
        await this.log(`Board "${board}" failed: ${err.message}`);
        continue;
      }
    }

    return allJobs;
  }

  normalizeJob(rawJob) {
    const applyUrl = rawJob.applicationFormUrl || `https://jobs.ashbyhq.com/${rawJob._board}/${rawJob.id}/application`;
    const description = stripHtml(rawJob.descriptionPlain || rawJob.descriptionHtml || '');

    const tags = [];
    if (rawJob.department) tags.push(rawJob.department);
    if (rawJob.team) tags.push(rawJob.team);

    return super.normalizeJob({
      source: 'ashby',
      source_site: 'ashby',
      sourceJobId: rawJob.id,
      title: rawJob.title,
      company: rawJob._board,
      location: rawJob.location || (rawJob.isRemote ? 'Remote' : 'Remote'),
      jobType: rawJob.isRemote ? 'Remote' : 'Full-Time',
      description,
      requiredSkills: tags.join(', '),
      tags,
      keywords: tags,
      applicationUrl: applyUrl,
      postedAt: rawJob.publishedAt || new Date().toISOString(),
      raw: rawJob
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

export async function scrapeAshbyJobs(config, siteConfig = {}) {
  return new AshbyScraper(config, siteConfig).scrape();
}

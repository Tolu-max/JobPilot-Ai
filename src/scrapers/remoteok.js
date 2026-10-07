import { BaseScraper, normalizeList } from './baseScraper.js';

export class RemoteOkScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('remoteok', config, siteConfig);
  }

  async fetchJobs() {
    const endpoint = this.siteConfig.apiUrl || 'https://remoteok.com/api';
    const payload = await this.fetchJson(endpoint, {
      headers: {
        Referer: 'https://remoteok.com/'
      }
    });

    return Array.isArray(payload) ? payload.filter((item) => item && item.id) : [];
  }

  normalizeJob(rawJob) {
    return super.normalizeJob({
      source: 'remoteok',
      source_site: 'remoteok',
      sourceJobId: rawJob.id,
      title: rawJob.position,
      company: rawJob.company,
      location: rawJob.location || 'Remote',
      description: rawJob.description,
      requirements: normalizeList(rawJob.tags).join(', '),
      requiredSkills: rawJob.tags,
      tags: rawJob.tags,
      salary: rawJob.salary_min || rawJob.salary_max ? `${rawJob.salary_min || ''}-${rawJob.salary_max || ''}` : '',
      applicationUrl: rawJob.apply_url || rawJob.url,
      postedAt: rawJob.date,
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

    const text = `${job.title || ''} ${job.location || ''} ${job.description || ''}`;
    if (this.siteConfig.englishOnly !== false && looksNonEnglish(text)) return false;

    return true;
  }
}

function isRecent(postedAt, maxAgeDays) {
  if (!postedAt) return true;
  const posted = new Date(postedAt).getTime();
  if (!Number.isFinite(posted)) return true;
  return Date.now() - posted <= maxAgeDays * 24 * 60 * 60 * 1000;
}

function looksNonEnglish(text) {
  const value = String(text || '').toLowerCase();
  const markers = [
    'contratación', 'contratacion', 'modalidad remota', 'asistente', 'auxiliar',
    'méxico', 'mexico', 'recursos humanos', 'híbrida', 'hibrida',
    '中', '讲师', '营养'
  ];
  return markers.some((marker) => value.includes(marker));
}

export async function scrapeRemoteOkJobs(config, siteConfig = {}) {
  return new RemoteOkScraper(config, siteConfig).scrape();
}

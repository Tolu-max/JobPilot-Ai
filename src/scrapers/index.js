import fs from 'node:fs/promises';
import path from 'node:path';
import { appendLog } from '../logger.js';
import { uniqueBy } from '../utils.js';
import { withRetry } from '../retry.js';
import { scrapeBruntWorkJobs } from './bruntwork.js';
import { scrapeInfluxJobs } from './influx.js';
import { scrapeRemoteOkJobs } from './remoteok.js';
import { scrapeRemotiveJobs } from './remotive.js';
import { scrapeHimalayasJobs } from './himalayas.js';
import { scrapeJobbermanJobs } from './jobberman.js';
import { scrapeRemoteJobsOrgJobs } from './remotejobsorg.js';
import { scrapeAshbyJobs } from './ashby.js';
import { scrapeWellfoundJobs } from './wellfound.js';
import { scrapeGreenhouseJobs } from './greenhouse.js';
import { scrapeWeWorkRemotelyJobs } from './weworkremotely.js';
import { scrapeJobicyJobs } from './jobicy.js';
import { scrapeTheMuseJobs } from './themuse.js';
import { scrapeArbeitnowJobs } from './arbeitnow.js';
import { scrapeRealWorkFromAnywhereJobs } from './realworkfromanywhere.js';
import { scrapeWorkingNomadsJobs } from './workingnomads.js';
import { scrapeMyJobMagJobs } from './myjobmag.js';
import { createPlatformMockJobs } from './platformMockJobs.js';
import { PlannedScraper } from './plannedScraper.js';

export const scraperRegistry = {
  bruntwork: { scrape: scrapeBruntWorkJobs, implemented: true },
  influx:    { scrape: scrapeInfluxJobs,    implemented: true },
  remoteok:  { scrape: scrapeRemoteOkJobs,  implemented: true },
  remotive:  { scrape: scrapeRemotiveJobs,  implemented: true },
  himalayas: { scrape: scrapeHimalayasJobs, implemented: true },
  jobberman: { scrape: scrapeJobbermanJobs, implemented: true },
  remotejobsorg: { scrape: scrapeRemoteJobsOrgJobs, implemented: true },
  ashby: { scrape: scrapeAshbyJobs, implemented: true },
  wellfound: { scrape: scrapeWellfoundJobs, implemented: true },
  greenhouse: { scrape: scrapeGreenhouseJobs, implemented: true },
  arbeitnow: { scrape: scrapeArbeitnowJobs, implemented: true },
  betternship: planned('betternship', 'Betternship scraper is not implemented yet.'),
  careernest: planned('careernest', 'CareerNest scraper is not implemented yet.'),
  dailyremote: planned('dailyremote', 'DailyRemote scraper is not implemented yet.'),
  dynamitejobs: planned('dynamitejobs', 'Dynamite Jobs scraper is not implemented yet.'),
  glassdoor: planned('glassdoor', 'Glassdoor scraper is not implemented yet.'),
  indeed: planned('indeed', 'Indeed scraper is not implemented yet.'),
  jobdataapi: planned('jobdataapi', 'JobDataAPI integration is not implemented yet.'),
  jobgether: planned('jobgether', 'Jobgether scraper is not implemented yet.'),
  jobicy: { scrape: scrapeJobicyJobs, implemented: true },
  jobspresso: planned('jobspresso', 'Jobspresso scraper is not implemented yet.'),
  linkedin: planned('linkedin', 'LinkedIn scraper is not implemented yet.'),
  myjobmag: { scrape: scrapeMyJobMagJobs, implemented: true },
  onlinejobsph: planned('onlinejobsph', 'OnlineJobs.ph scraper is not implemented yet.'),
  remoteco: planned('remoteco', 'Remote.co scraper is not implemented yet.'),
  remoteyeah: planned('remoteyeah', 'RemoteYeah scraper is not implemented yet.'),
  themuse: { scrape: scrapeTheMuseJobs, implemented: true },
  weworkremotely: { scrape: scrapeWeWorkRemotelyJobs, implemented: true },
  workingnomads: { scrape: scrapeWorkingNomadsJobs, implemented: true },
  realworkfromanywhere: { scrape: scrapeRealWorkFromAnywhereJobs, implemented: true }
};

function planned(siteName, note) {
  return {
    implemented: false,
    scrape: (config, siteConfig = {}) => new PlannedScraper(siteName, config, siteConfig, note).scrape()
  };
}

export async function scrapeJobs(config) {
  const result = await runScrapers(config);
  scrapeJobs.lastRun = result;
  return result.jobs;
}

export async function runScrapers(config) {
  const enabledSites = orderedEnabledSites(config);
  const state = await loadRunState(config);
  const siteResults = [];
  const errors = [];
  const jobs = [];

  for (const site of enabledSites) {
    const entry = scraperRegistry[site];
    const siteConfig = config.sites?.[site] || {};

    if (!entry) {
      const message = `Unknown scraper "${site}" is enabled; skipping.`;
      errors.push({ site, message });
      await appendLog(message, config);
      continue;
    }

    if (isCoolingDown(site, siteConfig, state)) {
      const result = { site, status: 'skipped_cooldown', jobCount: 0 };
      siteResults.push(result);
      await appendLog(`${site} scraper skipped because it is still cooling down.`, config);
      continue;
    }

    const startedAt = new Date().toISOString();
    try {
      const siteJobs = await runSiteScraper(entry, config, site, siteConfig);
      jobs.push(...siteJobs);
      siteResults.push({
        site,
        status: 'ok',
        implemented: entry.implemented,
        jobCount: siteJobs.length,
        startedAt,
        finishedAt: new Date().toISOString()
      });
      await updateRunState(config, state, site, { status: 'ok', jobCount: siteJobs.length });
      await appendLog(`${site} scraper returned ${siteJobs.length} job(s).`, config);
    } catch (error) {
      const message = `${site} scraper failed: ${error.stack || error.message}`;
      errors.push({ site, message: error.message });
      siteResults.push({
        site,
        status: 'failed',
        implemented: entry.implemented,
        jobCount: 0,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: error.message
      });
      await updateRunState(config, state, site, { status: 'failed', error: error.message });
      await appendLog(message, config);
    }
  }

  const dedupedJobs = uniqueBy(jobs, (job) => job.jobHash || `${job.source}:${job.applicationUrl}`);
  return {
    jobs: dedupedJobs,
    siteResults,
    errors,
    jobsScanned: jobs.length,
    dedupedJobs: jobs.length - dedupedJobs.length
  };
}

export function orderedEnabledSites(config) {
  const configuredSites = Object.entries(config.sites || {})
    .filter(([, siteConfig]) => siteConfig?.enabled)
    .map(([site]) => site);
  const enabled = (config.enabledSites?.length ? config.enabledSites : configuredSites.length ? configuredSites : ['bruntwork'])
    .map(normalizeSiteName)
    .filter(Boolean);

  return Array.from(new Set(enabled)).sort((left, right) => {
    const leftPriority = Number.parseInt(config.sites?.[left]?.priority, 10);
    const rightPriority = Number.parseInt(config.sites?.[right]?.priority, 10);
    return (Number.isFinite(leftPriority) ? leftPriority : 999) - (Number.isFinite(rightPriority) ? rightPriority : 999);
  });
}

async function runSiteScraper(entry, config, site, siteConfig) {
  if ((config.testPlatformMode || config.e2eTestMode) && config.platformScrapeMode !== 'limited') {
    return createPlatformMockJobs(site, config, siteConfig);
  }

  const retries = Number.parseInt(siteConfig.retries, 10);
  const retryCount = Number.isFinite(retries) ? retries : 1;
  const timeoutMs = Number.parseInt(siteConfig.timeoutMs, 10) || 120000;

  return withTimeout(
    () =>
      withRetry(() => entry.scrape({ ...config, siteJobLimit: siteConfig.maxJobsPerRun }, siteConfig), {
        retries: retryCount,
        delayMs: Number.parseInt(siteConfig.retryDelayMs, 10) || 3000
      }),
    timeoutMs,
    `${site} scraper timed out after ${timeoutMs}ms`
  );
}

function isCoolingDown(site, siteConfig, state) {
  // Manual snooze (set via the Telegram /snooze command) always wins.
  const snoozeUntil = state.sites?.[site]?.snoozeUntil;
  if (snoozeUntil && Date.now() < new Date(snoozeUntil).getTime()) return true;

  const cooldownMinutes = Number.parseInt(siteConfig.cooldownMinutes, 10);
  if (!Number.isFinite(cooldownMinutes) || cooldownMinutes <= 0) return false;

  const lastRunAt = state.sites?.[site]?.lastRunAt;
  if (!lastRunAt) return false;

  const nextAllowedAt = new Date(lastRunAt).getTime() + cooldownMinutes * 60 * 1000;
  return Date.now() < nextAllowedAt;
}

async function withTimeout(task, timeoutMs, message) {
  let timeout;
  try {
    return await Promise.race([
      task(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadRunState(config) {
  const filePath = runStatePath(config);
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return { sites: {} };
  }
}

async function updateRunState(config, state, site, result) {
  const filePath = runStatePath(config);
  state.sites ||= {};
  state.sites[site] = {
    ...(state.sites[site] || {}),
    lastRunAt: new Date().toISOString(),
    lastStatus: result.status,
    lastJobCount: result.jobCount || 0,
    lastError: result.error || ''
  };
  if (result.status === 'ok') {
    state.sites[site].lastSuccessAt = state.sites[site].lastRunAt;
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function runStatePath(config) {
  return config.siteRunStatePath || path.resolve(process.cwd(), 'data', 'siteRunState.json');
}

function normalizeSiteName(site) {
  return String(site || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

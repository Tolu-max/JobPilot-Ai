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
import { scrapeLeverJobs } from './lever.js';
import { scrapeBambooHRJobs } from './bamboohr.js';
import { scrapeBreezyHrJobs } from './breezyhr.js';
import { scrapeDailyRemoteJobs } from './dailyremote.js';
import { scrapeSmartRecruitersJobs } from './smartrecruiters.js';
import { scrapeWorkableJobs } from './workable.js';
import { scrapeHotNigerianJobs } from './hotnigerianjobs.js';
import { scrapeJobzillaJobs } from './jobzilla.js';
import { scrapeJobGurusJobs } from './jobgurus.js';
import { scrapeGlassdoorJobs } from './glassdoorImport.js';
import { scrapeIndeedJobs } from './indeed.js';
import { scrapeLinkedinJobs } from './linkedin.js';
import { createPlatformMockJobs } from './platformMockJobs.js';
import { PlannedScraper } from './plannedScraper.js';

export const scraperRegistry = {
  bruntwork: { scrape: scrapeBruntWorkJobs, implemented: true },
  influx:    { scrape: scrapeInfluxJobs,    implemented: true },
  remoteok:  { scrape: scrapeRemoteOkJobs,  implemented: true },
  remotive:  { scrape: scrapeRemotiveJobs,  implemented: true },
  himalayas: { scrape: scrapeHimalayasJobs, implemented: true },
  jobberman: { scrape: scrapeJobbermanJobs, implemented: true },
  myjobmag:  { scrape: scrapeMyJobMagJobs,  implemented: true },
  remotejobsorg: { scrape: scrapeRemoteJobsOrgJobs, implemented: true },
  ashby: { scrape: scrapeAshbyJobs, implemented: true },
  wellfound: { scrape: scrapeWellfoundJobs, implemented: true },
  greenhouse: { scrape: scrapeGreenhouseJobs, implemented: true },
  lever: { scrape: scrapeLeverJobs, implemented: true },
  bamboohr: { scrape: scrapeBambooHRJobs, implemented: true },
  breezyhr: { scrape: scrapeBreezyHrJobs, implemented: true },
  smartrecruiters: { scrape: scrapeSmartRecruitersJobs, implemented: true },
  workable: { scrape: scrapeWorkableJobs, implemented: true },
  arbeitnow: { scrape: scrapeArbeitnowJobs, implemented: true },
  workingnomads: { scrape: scrapeWorkingNomadsJobs, implemented: true },
  realworkfromanywhere: { scrape: scrapeRealWorkFromAnywhereJobs, implemented: true },
  jobicy: { scrape: scrapeJobicyJobs, implemented: true },
  weworkremotely: { scrape: scrapeWeWorkRemotelyJobs, implemented: true },
  themuse: { scrape: scrapeTheMuseJobs, implemented: true },
  dailyremote: { scrape: scrapeDailyRemoteJobs, implemented: true },
  hotnigerianjobs: { scrape: scrapeHotNigerianJobs, implemented: true },
  jobzilla: { scrape: scrapeJobzillaJobs, implemented: true },
  jobgurus: { scrape: scrapeJobGurusJobs, implemented: true },
  betternship: planned('betternship', 'Betternship scraper is not implemented yet.'),
  careernest: planned('careernest', 'CareerNest scraper is not implemented yet.'),
  dynamitejobs: planned('dynamitejobs', 'Dynamite Jobs scraper is not implemented yet.'),
  glassdoor: { scrape: scrapeGlassdoorJobs, implemented: true },
  indeed: { scrape: scrapeIndeedJobs, implemented: true },
  jobdataapi: planned('jobdataapi', 'JobDataAPI scraper is not implemented yet.'),
  jobgether: planned('jobgether', 'Jobgether scraper is not implemented yet.'),
  jobspresso: planned('jobspresso', 'Jobspresso scraper is not implemented yet.'),
  linkedin: { scrape: scrapeLinkedinJobs, implemented: true },
  onlinejobsph: planned('onlinejobsph', 'OnlineJobs.ph scraper is not implemented yet.'),
  remoteco: planned('remoteco', 'Remote.co scraper is not implemented yet.'),
  remoteyeah: planned('remoteyeah', 'RemoteYeah scraper is not implemented yet.')
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

  async function runSingleSite(site) {
    const entry = scraperRegistry[site];
    const siteConfig = {
      ...(config.sites?.[site] || {}),
      lastSeenJobUrl: state.sites?.[site]?.lastSeenJobUrl || ''
    };

    if (!entry) {
      const message = `Unknown scraper "${site}" is enabled; skipping.`;
      await appendLog(message, config);
      return { error: { site, message } };
    }

    if (isCoolingDown(site, siteConfig, state)) {
      await appendLog(`${site} scraper skipped because it is still cooling down.`, config);
      return { siteResult: { site, status: 'skipped_cooldown', jobCount: 0 } };
    }

    const startedAt = new Date().toISOString();
    try {
      console.log(`[scrapers] Running ${site} scraper for ${config.profileName}...`);
      const siteJobs = await runSiteScraper(entry, config, site, siteConfig);
      await updateRunState(config, state, site, {
        status: 'ok',
        jobCount: siteJobs.length,
        startedAt,
        latestJobUrl: siteJobs[0]?.applicationUrl || siteJobs[0]?.jobUrl || ''
      });
      console.log(`[scrapers] ${site} scraper finished for ${config.profileName}: ${siteJobs.length} job(s) found.`);
      await appendLog(`${site} scraper returned ${siteJobs.length} job(s).`, config);
      return {
        jobs: siteJobs,
        siteResult: {
          site,
          status: 'ok',
          implemented: entry.implemented,
          jobCount: siteJobs.length,
          startedAt,
          finishedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      const message = `${site} scraper failed: ${error.stack || error.message}`;
      console.warn(`[scrapers] ${site} scraper failed for ${config.profileName}: ${error.message}`);
      await updateRunState(config, state, site, {
        status: 'failed',
        error: error.message,
        startedAt
      });
      await appendLog(message, config);
      return {
        error: { site, message: error.message },
        siteResult: {
          site,
          status: 'failed',
          implemented: entry.implemented,
          jobCount: 0,
          startedAt,
          finishedAt: new Date().toISOString(),
          error: error.message
        }
      };
    }
  }

  const concurrency = Math.max(1, Number.parseInt(config.scraperConcurrency, 10) || 3);
  const settled = [];
  for (let i = 0; i < enabledSites.length; i += concurrency) {
    const batch = enabledSites.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map((site) => runSingleSite(site)));
    settled.push(...batchResults);
  }
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled' && outcome.value) {
      if (outcome.value.jobs) jobs.push(...outcome.value.jobs);
      if (outcome.value.siteResult) siteResults.push(outcome.value.siteResult);
      if (outcome.value.error) errors.push(outcome.value.error);
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
  const timeoutMs = Number.parseInt(siteConfig.timeoutMs, 10) || 45000;

  return withTimeout(
    () =>
      withRetry(() => entry.scrape({ ...config, siteJobLimit: siteConfig.maxJobsPerRun }, siteConfig), {
        retries: retryCount,
        delayMs: Number.parseInt(siteConfig.retryDelayMs, 10) || 3000,
        // Authentication/edge blocks are deterministic for this run. Retrying
        // them amplifies noise and can worsen rate limiting (notably TheMuse).
        shouldRetry: (error) => ![401, 403].includes(Number(error?.status))
      }),
    timeoutMs,
    `${site} scraper timed out after ${timeoutMs}ms`
  );
}

export function isCoolingDown(site, siteConfig, state) {
  const cooldownMinutes = Number.parseInt(siteConfig.cooldownMinutes, 10);
  if (!Number.isFinite(cooldownMinutes) || cooldownMinutes <= 0) return false;

  const lastStartedAt = state.sites?.[site]?.lastStartedAt || state.sites?.[site]?.lastRunAt;
  if (!lastStartedAt) return false;

  const cooldownMs = cooldownMinutes * 60 * 1000;
  const nextAllowedAt = new Date(lastStartedAt).getTime() + cooldownMs;
  const graceMs = Math.min(30_000, Math.max(1_000, Math.round(cooldownMs * 0.05)));
  return Date.now() + graceMs < nextAllowedAt;
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

export async function updateRunState(config, state, site, result) {
  const filePath = runStatePath(config);
  const finishedAt = new Date().toISOString();
  state.sites ||= {};
  const previous = state.sites[site] || {};
  state.sites[site] = {
    ...previous,
    lastStartedAt: result.startedAt || finishedAt,
    lastRunAt: finishedAt,
    lastStatus: result.status,
    lastJobCount: result.jobCount || 0,
    lastSeenJobUrl: result.latestJobUrl || previous.lastSeenJobUrl || '',
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

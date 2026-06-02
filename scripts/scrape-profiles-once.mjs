import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildConfig } from '../src/config.js';
import { scraperRegistry } from '../src/scrapers/index.js';

const rootDir = process.cwd();
const scriptPath = fileURLToPath(import.meta.url);
const args = parseArgs(process.argv.slice(2));
const profiles = String(args.profiles || 'sister,tolu').split(',').map((item) => item.trim()).filter(Boolean);
const maxJobs = clampInt(args.maxJobs || process.env.SCRAPE_ONLY_MAX_JOBS, 1, 200, 50);
const timeoutMs = clampInt(args.timeoutMs || process.env.SCRAPE_ONLY_TIMEOUT_MS, 10_000, 300_000, 90_000);
const includeAllImplemented = Boolean(args.allImplemented);

if (args.worker) {
  await runWorker(args);
} else {
  await runParent();
}

async function runParent() {
  const report = {
    ranAt: new Date().toISOString(),
    mode: 'scrape-only',
    note: 'No scoring, no form fill, no application submit.',
    requestedMaxSites: 50,
    implementedScrapers: Object.entries(scraperRegistry).filter(([, entry]) => entry.implemented).map(([site]) => site).sort(),
    profiles: []
  };

  for (const profile of profiles) {
    const config = buildConfig(['node', 'scrape-profiles-once', `--profile=${profile}`]);
    const enabledImplemented = includeAllImplemented
      ? report.implementedScrapers
      : config.enabledSites.filter((site) => scraperRegistry[site]?.implemented);
    const skipped = config.enabledSites.filter((site) => !scraperRegistry[site]?.implemented);
    const profileResult = {
      profile,
      enabledImplemented,
      skipped,
      siteResults: [],
      jobs: [],
      jobsScanned: 0,
      dedupedJobs: 0
    };

    console.log(`\n=== ${profile.toUpperCase()} ===`);
    console.log(`Scrapers selected: ${enabledImplemented.join(', ') || '(none)'}`);
    if (skipped.length) console.log(`Skipped unimplemented: ${skipped.join(', ')}`);

    const seen = new Set();
    for (const site of enabledImplemented) {
      const result = await runSiteWorker(profile, site);
      profileResult.siteResults.push(withoutJobs(result));
      const jobs = Array.isArray(result.jobs) ? result.jobs : [];
      profileResult.jobsScanned += jobs.length;
      for (const job of jobs) {
        const key = job.jobHash || `${job.source}:${job.applicationUrl}`;
        if (seen.has(key)) {
          profileResult.dedupedJobs += 1;
          continue;
        }
        seen.add(key);
        profileResult.jobs.push(job);
      }
      console.log(formatSiteResult(result));
    }

    console.log(`Total jobs after dedupe: ${profileResult.jobs.length} (scanned=${profileResult.jobsScanned}, deduped=${profileResult.dedupedJobs})`);
    console.log('Sample latest jobs:');
    for (const job of profileResult.jobs.slice(0, 10)) {
      console.log(`- [${job.source}] ${job.title || '(untitled)'} @ ${job.company || 'Unknown'} | ${job.postedAt || 'date unknown'}`);
    }
    report.profiles.push(profileResult);
  }

  const outDir = path.join(rootDir, 'data', 'manual-scrapes');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `scrape-only-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await fs.writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\nSaved report: ${outPath}`);
}

async function runSiteWorker(profile, site) {
  const childArgs = [
    scriptPath,
    '--worker',
    `--profile=${profile}`,
    `--site=${site}`,
    `--maxJobs=${maxJobs}`,
    `--timeoutMs=${timeoutMs}`
  ];

  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, childArgs, {
      cwd: rootDir,
      env: {
        ...process.env,
        NO_REAL_SUBMISSION: 'true',
        TEST_MODE: 'true'
      },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({
        site,
        status: 'timeout',
        jobCount: 0,
        durationMs: Date.now() - started,
        error: `Timed out after ${timeoutMs}ms`
      });
    }, timeoutMs + 5_000);

    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({
          site,
          status: 'fail',
          jobCount: 0,
          durationMs: Date.now() - started,
          error: truncate(stderr || stdout || `worker exited ${code}`, 300)
        });
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve({
          site,
          status: 'fail',
          jobCount: 0,
          durationMs: Date.now() - started,
          error: truncate(stdout || stderr || 'worker returned invalid JSON', 300)
        });
      }
    });
  });
}

async function runWorker(workerArgs) {
  console.log = (...items) => process.stderr.write(`${items.join(' ')}\n`);
  console.info = console.log;
  console.warn = (...items) => process.stderr.write(`${items.join(' ')}\n`);
  console.error = (...items) => process.stderr.write(`${items.join(' ')}\n`);

  const started = Date.now();
  const profile = workerArgs.profile;
  const site = workerArgs.site;
  const config = buildConfig(['node', 'scrape-worker', `--profile=${profile}`]);
  const siteConfig = {
    ...(config.sites?.[site] || {}),
    enabled: true,
    cooldownMinutes: 0,
    maxJobsPerRun: maxJobs
  };
  const entry = scraperRegistry[site];
  if (!entry?.implemented) {
    writeJson({
      site,
      status: 'skipped',
      jobCount: 0,
      durationMs: Date.now() - started,
      error: 'Scraper is not implemented.'
    });
    return;
  }

  try {
    const jobs = await entry.scrape({
      ...config,
      maxJobsPerRun: maxJobs,
      siteJobLimit: maxJobs,
      noRealSubmission: true,
      testMode: true
    }, siteConfig);
    const normalized = (Array.isArray(jobs) ? jobs : []).map((job) => ({
      source: job.source_site || job.source || site,
      title: job.title || '',
      company: job.company || '',
      location: job.location || '',
      postedAt: job.postedAt || '',
      applicationUrl: job.applicationUrl || job.url || '',
      jobHash: job.jobHash || ''
    }));
    writeJson({
      site,
      status: 'ok',
      jobCount: normalized.length,
      durationMs: Date.now() - started,
      jobs: normalized
    });
  } catch (error) {
    writeJson({
      site,
      status: 'fail',
      jobCount: 0,
      durationMs: Date.now() - started,
      error: error.message || String(error)
    });
  }
}

function writeJson(value) {
  process.stdout.write(JSON.stringify(value));
}

function withoutJobs(result) {
  const { jobs, ...rest } = result;
  return rest;
}

function formatSiteResult(result) {
  const status = String(result.status || 'unknown').toUpperCase().padEnd(8);
  const site = String(result.site || '').padEnd(14);
  const count = String(result.jobCount || 0).padStart(3);
  const duration = String(result.durationMs || 0).padStart(6);
  return `${status} ${site} jobs=${count} ${duration}ms${result.error ? ` error=${truncate(result.error, 120)}` : ''}`;
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, ...rest] = arg.slice(2).split('=');
      parsed[key] = rest.length ? rest.join('=') : true;
    }
  }
  return parsed;
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function truncate(value, max) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

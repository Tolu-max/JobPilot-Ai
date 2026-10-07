import fs from 'node:fs/promises';
import path from 'node:path';
import { scraperRegistry } from '../src/scrapers/index.js';

const rootDir = process.cwd();
const configPath = path.join(rootDir, 'config', 'sites.json');
const siteConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));

const args = new Set(process.argv.slice(2));
const includeDisabled = args.has('--all');
const filterArg = process.argv.find((arg) => arg.startsWith('--only='));
const onlySites = filterArg ? new Set(filterArg.slice('--only='.length).split(',')) : null;
const perSiteLimit = Number.parseInt(process.env.HEALTH_MAX_JOBS, 10) || 3;
const perSiteTimeout = Number.parseInt(process.env.HEALTH_TIMEOUT_MS, 10) || 60000;

const targets = Object.keys(scraperRegistry)
  .filter((site) => (includeDisabled ? true : siteConfig[site]?.enabled))
  .filter((site) => (onlySites ? onlySites.has(site) : true))
  .sort();

if (targets.length === 0) {
  console.error('No scrapers selected. Use --all to include disabled or --only=site1,site2.');
  process.exit(1);
}

console.log(`Running live smoke test against ${targets.length} scraper(s); max ${perSiteLimit} job(s) each.`);
console.log();

const baseConfig = {
  maxJobsPerRun: perSiteLimit,
  applicantEmail: 'health@example.com',
  headless: true,
  browserProfileDir: path.join(rootDir, 'browser-profiles', '_health'),
  geminiApiKey: process.env.GEMINI_API_KEY || ''
};

const results = [];
let okCount = 0;
let zeroCount = 0;
let failCount = 0;

for (const site of targets) {
  const entry = scraperRegistry[site];
  const start = Date.now();
  let status = 'ok';
  let jobCount = 0;
  let error = '';
  try {
    const jobs = await withTimeout(
      () => entry.scrape({ ...baseConfig }, { ...(siteConfig[site] || {}), maxJobsPerRun: perSiteLimit }),
      perSiteTimeout,
      `${site} health check timed out after ${perSiteTimeout}ms`
    );
    jobCount = Array.isArray(jobs) ? jobs.length : 0;
    if (jobCount === 0) {
      status = 'zero';
      zeroCount += 1;
    } else {
      okCount += 1;
    }
  } catch (err) {
    status = 'fail';
    error = err.message || String(err);
    failCount += 1;
  }
  const durationMs = Date.now() - start;
  results.push({ site, status, jobCount, durationMs, error });
  console.log(formatRow({ site, status, jobCount, durationMs, error }));
}

console.log();
console.log(`Summary: ok=${okCount}  zero=${zeroCount}  fail=${failCount}`);

if (failCount > 0 || zeroCount > 0) {
  process.exitCode = failCount > 0 ? 1 : 0;
}

function formatRow({ site, status, jobCount, durationMs, error }) {
  const tag = status === 'ok' ? 'OK  ' : status === 'zero' ? 'ZERO' : 'FAIL';
  const line = `${tag}  ${site.padEnd(16)} jobs=${String(jobCount).padStart(2)}  ${durationMs.toString().padStart(5)}ms`;
  return error ? `${line}  ${truncate(error, 120)}` : line;
}

function truncate(text, max) {
  const str = String(text || '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

async function withTimeout(task, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      task(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

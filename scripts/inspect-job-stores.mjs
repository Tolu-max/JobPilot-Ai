import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const profiles = parseProfiles(process.argv.slice(2));

for (const profile of profiles) {
  const storePath = resolveStorePath(profile);
  const store = await readJson(storePath);
  const jobs = Array.isArray(store.jobs) ? store.jobs : [];
  const counts = countBy(jobs, (job) => job.status || 'unknown');
  const decisions = countBy(jobs, (job) => job.decision || 'none');
  const sources = countBy(jobs, (job) => job.source_site || job.source || 'unknown');

  console.log(`\n${profile}`);
  console.log(`  store: ${storePath}`);
  console.log(`  total: ${jobs.length}`);
  console.log(`  statuses: ${formatCounts(counts)}`);
  console.log(`  decisions: ${formatCounts(decisions)}`);
  console.log(`  sources: ${formatCounts(sources)}`);

  const nonIgnored = jobs.filter((job) => job.status !== 'ignored');
  console.log(`  non-ignored jobs (${nonIgnored.length}):`);
  for (const job of nonIgnored) {
    console.log(`  - status=${job.status} | score=${job.score ?? '-'} | site=${job.source_site || job.source || 'unknown'} | title="${job.title}" | hash=${job.job_hash || job.hash} | url=${job.applicationUrl || job.job_url}`);
    if (job.reason) console.log(`    reason: ${job.reason}`);
  }
}

function parseProfiles(args) {
  const profileArg = args.find((arg) => arg.startsWith('--profiles='));
  if (profileArg) {
    return profileArg.slice('--profiles='.length).split(',').map((item) => item.trim()).filter(Boolean);
  }
  return args.filter((arg) => !arg.startsWith('-')).length
    ? args.filter((arg) => !arg.startsWith('-'))
    : ['tolu', 'sister'];
}

function resolveStorePath(profile) {
  if (profile.endsWith('.json')) return path.resolve(rootDir, profile);
  const downloaded = path.resolve(rootDir, '.railway-inspect', `${profile}-processedJobs.json`);
  return downloadedExists(downloaded) ? downloaded : path.resolve(rootDir, 'profiles', profile, 'processedJobs.json');
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw.replace(/^\uFEFF/, ''));
}

function countBy(items, getKey) {
  const counts = {};
  for (const item of items) {
    const key = getKey(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function formatCounts(counts) {
  const entries = Object.entries(counts).sort((left, right) => right[1] - left[1]);
  return entries.length ? entries.map(([key, count]) => `${key}=${count}`).join(', ') : 'none';
}

function compact(value, max = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function reviewReason(job) {
  return [
    job.local?.reasons,
    job.gemini?.reasoning,
    job.optimizer?.risk_flags?.map((flag) => flag.message)
  ].flat().filter(Boolean).join(' ');
}

function downloadedExists(filePath) {
  return existsSync(filePath);
}

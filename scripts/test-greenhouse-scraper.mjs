// Quick local test: fetch a few jobs from a single Greenhouse board.
// Usage: node scripts/test-greenhouse-scraper.mjs [board-token] [limit]
import { scrapeGreenhouseJobs } from '../src/scrapers/greenhouse.js';

const board = process.argv[2] || 'zapier';
const limit = Number.parseInt(process.argv[3] || '3', 10);

const config = { maxJobsPerRun: limit };
const siteConfig = {
  boards: [{ token: board, company: board }],
  maxJobsPerRun: limit,
  remoteOnly: true,
  maxAgeDays: 14
};

try {
  const jobs = await scrapeGreenhouseJobs(config, siteConfig);
  console.log(`\n✅ Found ${jobs.length} job(s) from board "${board}"`);
  for (const job of jobs) {
    console.log(`- ${job.title} @ ${job.company} (${job.location})`);
    console.log(`  URL: ${job.applicationUrl}`);
  }
} catch (e) {
  console.log('❌ Scraper failed:', e.message);
  process.exitCode = 1;
}

if (process.env.RUN_LIVE_SCRAPER_TESTS !== '1') {
  console.log('Skipping live scraper smoke test. Set RUN_LIVE_SCRAPER_TESTS=1 to run it.');
  process.exit(0);
}

const { scraperRegistry } = await import('./src/scrapers/index.js');

const active = Object.entries(scraperRegistry).filter(([, info]) => info.implemented);
console.log('Testing', active.length, 'scrapers...');

for (const [name, info] of active) {
  try {
    console.log('Testing', name, '...');
    const jobs = await info.scrape({
      rootDir: process.cwd(),
      preferences: { keywords: ['remote'] },
      jobsUrl: 'https://bruntworkcareers.co/jobs',
      browserProfileDir: 'browser-profiles/smoke',
      headless: true,
      minDelayMs: 1,
      maxDelayMs: 1
    }, { maxJobsPerRun: 1, retries: 1 });
    console.log('  -> Success! Found', jobs.length, 'jobs.');
  } catch (err) {
    console.error('  -> Failed:', err.message);
    process.exitCode = 1;
  }
}

console.log('All scraper smoke tests finished.');

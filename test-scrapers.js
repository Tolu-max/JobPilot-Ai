if (process.env.RUN_LIVE_SCRAPER_TESTS !== '1') {
  console.log('Skipping live targeted scraper test. Set RUN_LIVE_SCRAPER_TESTS=1 to run it.');
  process.exit(0);
}

const { scrapeWellfoundJobs } = await import('./src/scrapers/wellfound.js');
const { scrapeOnlineJobsPhJobs } = await import('./src/scrapers/onlinejobsph.js');

console.log('Testing Wellfound...');
const wellfoundJobs = await scrapeWellfoundJobs({
  preferences: { wellfoundKeywords: ['react'] }
}, { maxJobsPerRun: 2 });
console.log('Wellfound Jobs:', wellfoundJobs.length);

console.log('Testing OnlineJobs.ph...');
const onlineJobs = await scrapeOnlineJobsPhJobs({}, { maxJobsPerRun: 2 });
console.log('OnlineJobs.ph Jobs:', onlineJobs.length);

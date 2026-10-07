import { scrapeAshbyJobs } from '../src/scrapers/ashby.js';
import { buildConfig } from '../src/config.js';

async function run() {
  console.log('Testing Ashby Scraper...');
  const config = buildConfig(['node', 'jobpilot', '--profile=tolu']);
  
  // Force it to use the new ashby scraper config
  const siteConfig = config.sites.ashby || {
    boards: ['close.com', 'n8n', 'firecrawl', 'openrouter']
  };

  try {
    const jobs = await scrapeAshbyJobs(config, siteConfig);
    console.log(`\nSuccessfully scraped ${jobs.length} jobs from Ashby!`);
    
    if (jobs.length > 0) {
      console.log('\nSample Job:');
      console.log(JSON.stringify(jobs[0], null, 2));
    }
  } catch (err) {
    console.error('Failed to scrape:', err);
  }
}

run();

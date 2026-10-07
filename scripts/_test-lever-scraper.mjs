import { buildConfig } from '../src/config.js';
import { scrapeLeverJobs } from '../src/scrapers/lever.js';

const argv = ['node', '_test-lever-scraper', '--profile=tolu'];
const config = buildConfig(argv);
config.sites.lever = {
  ...(config.sites.lever || {}),
  enabled: true,
  autoApplyEnabled: false,
  maxJobsPerRun: 5,
  boards: ['activecampaign'],
  remoteOnly: false
};

const jobs = await scrapeLeverJobs(config, config.sites.lever);
console.log(`Scraped ${jobs.length} Lever job(s) from activecampaign`);
for (const job of jobs.slice(0, 5)) {
  console.log(`- ${job.title} | ${job.location} | ${job.applicationUrl}`);
}

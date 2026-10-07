import { AshbyScraper } from '../src/scrapers/ashby.js';
import { GreenhouseScraper } from '../src/scrapers/greenhouse.js';
import { buildConfig } from '../src/config.js';

async function main() {
  const config = buildConfig(['node', 'jobpilot', '--profile=sister']);
  const ashby = new AshbyScraper(config, {});
  const greenhouse = new GreenhouseScraper(config, {});

  console.log('Fetching Ashby jobs...');
  const ashbyJobs = await ashby.fetchJobs();
  console.log(`Fetched ${ashbyJobs.length} Ashby jobs`);

  console.log('Fetching Greenhouse jobs...');
  const ghJobs = await greenhouse.fetchJobs();
  console.log(`Fetched ${ghJobs.length} Greenhouse jobs`);

  const allJobs = [
    ...ashbyJobs.map(j => ashby.normalizeJob(j)),
    ...ghJobs.map(j => greenhouse.normalizeJob(j))
  ];

  console.log(`Total normalized jobs: ${allJobs.length}`);

  // Filter for Sister's keywords: customer support, customer success, administrative, operations, assistant, specialist
  const sisterKeywords = /customer (support|service|success|care|operations)|virtual assistant|executive assistant|administrative assistant|operations coordinator|operations associate|support specialist|client support/i;
  const matches = allJobs.filter(j => sisterKeywords.test(j.title));

  console.log(`\nFound ${matches.length} matching jobs for Sister:`);
  for (const m of matches) {
    console.log(`- [${m.source}] ${m.title} at ${m.company} (${m.location})`);
    console.log(`  Apply: ${m.applicationUrl}`);
  }
}

main().catch(console.error);

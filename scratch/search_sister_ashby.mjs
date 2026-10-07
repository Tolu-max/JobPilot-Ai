import { AshbyScraper } from '../src/scrapers/ashby.js';
import { buildConfig } from '../src/config.js';

async function main() {
  const config = buildConfig(['node', 'jobpilot', '--profile=sister']);
  const ashby = new AshbyScraper(config, {});
  const ashbyJobs = await ashby.fetchJobs();
  const normalized = ashbyJobs.map(j => ashby.normalizeJob(j));

  const sisterKeywords = /customer (support|service|success|care|operations)|virtual assistant|executive assistant|administrative assistant|operations coordinator|operations associate|support specialist|client support/i;
  const matches = normalized.filter(j => sisterKeywords.test(j.title));

  console.log(`Found ${matches.length} Ashby matches for Sister:`);
  for (const m of matches) {
    console.log(`- ${m.title} at ${m.company} (${m.location})`);
    console.log(`  Apply: ${m.applicationUrl}`);
  }
}

main().catch(console.error);

import { BruntWorkScraper, parseListingLinks, parseJobDetail } from '../src/scrapers/bruntwork.js';
import { localMatchJob } from '../src/localMatcher.js';
import fs from 'node:fs';

async function test() {
  const toluCandidate = JSON.parse(fs.readFileSync('profiles/tolu/candidateProfile.json', 'utf8'));
  const sisterCandidate = JSON.parse(fs.readFileSync('profiles/sister/candidateProfile.json', 'utf8'));
  const toluPrefs = JSON.parse(fs.readFileSync('profiles/tolu/preferences.json', 'utf8'));
  const sisterPrefs = JSON.parse(fs.readFileSync('profiles/sister/preferences.json', 'utf8'));

  const scraper = new BruntWorkScraper({ jobsUrl: 'https://bruntworkcareers.co/jobs' }, {});
  const html = await scraper.fetchText('https://bruntworkcareers.co/jobs?_t=' + Date.now());
  const jobLinks = parseListingLinks(html, 'https://bruntworkcareers.co/jobs');

  console.log(`Analyzing all ${jobLinks.length} current live jobs on BruntWork:\n`);

  for (let i = 0; i < jobLinks.length; i++) {
    const link = jobLinks[i];
    let detail;
    try {
      const detailHtml = await scraper.fetchText(link.detailUrl || link.applicationUrl.replace(/\/apply\/?$/, ''), { timeoutMs: 8000 });
      detail = parseJobDetail(detailHtml, link);
    } catch (e) {
      console.log(`Failed detail for ${link.title}: ${e.message}`);
      continue;
    }

    const toluRes = await localMatchJob(detail, toluCandidate, { preferences: toluPrefs });
    const sisterRes = await localMatchJob(detail, sisterCandidate, { preferences: sisterPrefs });

    console.log(`[${i+1}/${jobLinks.length}] ${detail.title}`);
    console.log(`  URL: ${detail.applicationUrl}`);
    console.log(`  Tolu:   Score=${toluRes.score} (${toluRes.recommendation}) | Reasons: ${(toluRes.reasons || []).join('; ')}`);
    console.log(`  Sister: Score=${sisterRes.score} (${sisterRes.recommendation}) | Reasons: ${(sisterRes.reasons || []).join('; ')}\n`);
  }
}

test().catch(console.error);

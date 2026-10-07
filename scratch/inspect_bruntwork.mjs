import { BruntWorkScraper } from '../src/scrapers/bruntwork.js';

async function run() {
  const scraper = new BruntWorkScraper({ jobsUrl: 'https://bruntworkcareers.co/jobs' }, {});
  const html = await scraper.fetchText('https://bruntworkcareers.co/jobs');
  console.log('HTML size:', html.length);

  // Search for pagination or data
  const hasPagination = html.includes('pagination') || html.includes('page=') || html.includes('Load More');
  console.log('Has pagination cues:', hasPagination);

  // Find all links
  const hrefs = [];
  const regex = /href=["']([^"']+)["']/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    hrefs.push(match[1]);
  }
  const jobLinks = hrefs.filter(h => h.includes('/jobs/'));
  console.log('Unique /jobs/ links:', [...new Set(jobLinks)]);

  // Check if there is an API or json endpoint
  const jsonMatches = html.match(/https?:\/\/[^\s"'<>]+\.json/g);
  console.log('JSON matches:', jsonMatches);
}

run().catch(console.error);

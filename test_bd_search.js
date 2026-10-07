import { fetchIndeedViaBrightData } from './src/scrapers/indeed.js';

async function test() {
  const token = 'a37e8852-05ae-474d-9b34-0099f2f9aa81';
  const jobUrl = 'https://www.indeed.com/viewjob?jk=45bec3555e2ec050';
  console.log('Fetching Bicycle Health job view via Bright Data MCP...');
  const res = await fetchIndeedViaBrightData(jobUrl, token);
  console.log('Markdown length:', res.markdown.length);

  // Find all links
  const links = [...res.markdown.matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)].map(m => ({ text: m[1], href: m[2] }));
  const applyLinks = links.filter(l => /apply|company|job/i.test(l.text) || /applystart|clk|greenhouse|lever|workable|ashby|bamboohr/i.test(l.href));
  console.log('Apply links found:', applyLinks);
}

test().catch(console.error);

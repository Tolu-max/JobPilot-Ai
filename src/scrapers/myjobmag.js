import { BaseScraper } from './baseScraper.js';

export class MyJobMagScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('myjobmag', config, siteConfig);
  }

  async fetchJobs() {
    const jobs = [];
    const queries = this.siteConfig.queries || ['remote', 'web developer', 'customer support'];

    for (const query of queries) {
      if (jobs.length >= this.maxJobsPerRun) break;
      const searchUrl = `https://www.myjobmag.com/search/jobs?q=${encodeURIComponent(query)}`;
      
      try {
        const html = await this.fetchText(searchUrl);
        if (!html) continue;

        const parsedJobs = parseMyJobMagListings(html, query);
        for (const job of parsedJobs) {
          if (jobs.length >= this.maxJobsPerRun) break;
          if (!jobs.some(j => j.applicationUrl === job.applicationUrl)) {
            jobs.push(job);
          }
        }
      } catch (err) {
        await this.log(`Error scraping query "${query}": ${err.message}`);
      }
    }

    return jobs;
  }
}

export async function scrapeMyJobMagJobs(config = {}, siteConfig = {}) {
  const scraper = new MyJobMagScraper(config, siteConfig);
  return scraper.scrape();
}

export function parseMyJobMagListings(html, query = '') {
  const jobs = [];
  // MyJobMag HTML list items structure parsing
  // Matches job headers: <li class="job-info"> ... <h2 ...><a href="/job/...">Title</a></h2> ... <span class="job-item-company">Company</span>
  const liRegex = /<li class="job-info"[^>]*>([\s\S]*?)<\/li>/gi;
  let match;

  while ((match = liRegex.exec(html)) !== null) {
    const block = match[1];
    
    // Extract Link and Title
    const titleMatch = block.match(/<h2>\s*<a href="(\/job\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i);
    if (!titleMatch) continue;

    const path = titleMatch[1];
    const rawTitle = titleMatch[2].replace(/<[^>]+>/g, '').trim();
    const titleParts = rawTitle.split(/\s+at\s+/i);
    const parsedTitle = titleParts[0].trim();
    const titleCompany = titleParts.slice(1).join(' at ').trim();
    const applicationUrl = path.startsWith('http') ? path : `https://www.myjobmag.com${path}`;

    // Extract Company
    const companyMatch = block.match(/class="[^"]*job-item-company[^"]*"[^>]*>([\s\S]*?)<\/(?:span|a|div)>/i) ||
                         block.match(/<a href="\/jobs-at\/[^"]+"[^>]*>([\s\S]*?)<\/a>/i);
    const company = companyMatch
      ? companyMatch[1].replace(/<[^>]+>/g, '').trim()
      : titleCompany || 'Unknown';

    // Extract Description / Summary snippet
    const descMatch = block.match(/<li class="job-desc"[^>]*>([\s\S]*?)<\/li>/i) ||
                      block.match(/<div class="job-desc"[^>]*>([\s\S]*?)<\/div>/i);
    const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : rawTitle;

    // Extract Location
    const locationMatch = block.match(/<span class="[^"]*location[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const location = locationMatch ? locationMatch[1].replace(/<[^>]+>/g, '').trim() : 'Nigeria (Remote)';

    const id = path.split('/').pop() || String(Date.now());

    jobs.push({
      id: `myjobmag-${id}`,
      title: parsedTitle || rawTitle,
      company,
      location,
      description,
      requirements: description,
      applicationUrl,
      source_site: 'myjobmag',
      source: 'myjobmag',
      postedAt: new Date().toISOString(),
      raw: { query }
    });
  }

  return jobs;
}

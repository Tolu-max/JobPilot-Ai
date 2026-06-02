import { chromium } from 'playwright';
import { BaseScraper, normalizeList } from './baseScraper.js';
import { compactText } from '../utils.js';
import { getStealthScript, stealthArgs, stealthUserAgent } from '../stealthInit.js';

const DEFAULT_URLS = [
  'https://wellfound.com/role/l/developer/nigeria',
  'https://wellfound.com/role/r/developer',
  'https://wellfound.com/role/r/frontend-developer',
  'https://wellfound.com/role/r/full-stack-developer'
];

export class WellfoundScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('wellfound', config, siteConfig);
  }

  async fetchJobs() {
    const urls = normalizeList(this.siteConfig.urls || this.siteConfig.searchUrls);
    const searchUrls = urls.length ? urls : DEFAULT_URLS;
    const jobs = [];

    const browser = await chromium.launch({
      headless: this.config.headless !== false,
      args: stealthArgs.filter((arg) => arg !== '--no-startup-window' && arg !== '--silent')
    });

    try {
      const context = await browser.newContext({
        userAgent: stealthUserAgent,
        viewport: { width: 1366, height: 768 },
        locale: 'en-US'
      });
      await context.addInitScript(getStealthScript());
      const page = await context.newPage();

      for (const url of searchUrls) {
        try {
          const pageJobs = await scrapeSearchPage(page, url);
          jobs.push(...pageJobs);
          await this.log(`Search page returned ${pageJobs.length} job(s): ${url}`);
        } catch (error) {
          await this.log(`Search page skipped: ${url} - ${error.message}`);
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }

    return jobs;
  }

  normalizeJob(rawJob) {
    return super.normalizeJob({
      source: 'wellfound',
      source_site: 'wellfound',
      company: rawJob.company || '',
      jobType: rawJob.jobType || 'Startup role',
      location: rawJob.location || 'Remote/Startup',
      ...rawJob
    });
  }

  matchesSitePolicy(job) {
    if (!super.matchesSitePolicy(job)) return false;
    if (this.siteConfig.remoteOnly === true && !/remote|anywhere|worldwide|nigeria/i.test(`${job.location} ${job.description}`)) {
      return false;
    }
    return true;
  }
}

async function scrapeSearchPage(page, url) {
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  const status = response?.status() || 0;
  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');

  if (status === 403 || /captcha|datadome|access denied|forbidden/i.test(bodyText)) {
    throw new Error('Wellfound blocked the request with CAPTCHA/403. Login cookies or manual browser access are required.');
  }

  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('a[href*="/jobs/"], a[href*="/company/"]'))
      .map((anchor) => {
        const href = anchor.href;
        const container = anchor.closest('li, article, section, div');
        const text = (container?.innerText || anchor.innerText || '').replace(/\s+/g, ' ').trim();
        const title =
          container?.querySelector('h2,h3,[data-testid*="title" i]')?.textContent?.trim() ||
          anchor.textContent?.trim() ||
          '';
        return { href, text, title };
      })
      .filter((item) => item.href && item.title);

    const seen = new Set();
    return cards
      .filter((item) => {
        const key = `${item.title}|${item.href}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 50)
      .map((item) => ({
        title: item.title,
        applicationUrl: item.href,
        description: item.text,
        location: inferLocation(item.text),
        company: inferCompany(item.text, item.title)
      }));

    function inferLocation(text) {
      const match = text.match(/\b(Remote|Nigeria|Lagos|Abuja|Worldwide|Anywhere|United States|Canada|Europe)\b/i);
      return match?.[0] || '';
    }

    function inferCompany(text, title) {
      const clean = text.replace(title, '').trim();
      return clean.split(/\s{2,}| · | - /).find(Boolean) || '';
    }
  }).then((jobs) =>
    jobs.map((job) => ({
      ...job,
      title: compactText(job.title),
      company: compactText(job.company),
      location: compactText(job.location),
      description: compactText(job.description)
    }))
  );
}

export async function scrapeWellfoundJobs(config, siteConfig = {}) {
  return new WellfoundScraper(config, siteConfig).scrape();
}

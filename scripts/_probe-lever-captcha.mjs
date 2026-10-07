import { chromium } from 'playwright';
import 'dotenv/config';

const boards = [
  'sonarsource', 'stripe', 'notion', 'shopify', 'airbnb', 'twilio', 'square',
  'github', 'gitlab', 'doordash', 'plaid', 'figma', 'vercel', 'linear',
  'mongodb', 'hashicorp', 'gradle', 'confluent', 'elastic', 'fastly', 'cloudflare',
  'carta', 'gusto', 'rippling', 'segment', 'zendesk', 'auth0', 'okta', '1password',
  'asana', 'monday', 'clickup', 'buffer', 'cisco', 'databricks', 'adobe'
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

for (const board of boards) {
  try {
    await page.goto(`https://jobs.lever.co/${board}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const firstLink = await page.locator('a.posting-title').first().getAttribute('href').catch(() => null);
    if (!firstLink) {
      console.log(`${board}: no listings`);
      continue;
    }
    const applyUrl = firstLink.replace(/\?.*$/, '').replace(/\/$/, '') + '/apply';
    await page.goto(applyUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    const captcha = await page.evaluate(() => {
      const hasRecaptcha = document.querySelector('.g-recaptcha, script[src*="recaptcha"], iframe[src*="recaptcha"]') !== null;
      const hasHcaptcha = document.querySelector('.h-captcha, script[src*="hcaptcha"], iframe[src*="hcaptcha"]') !== null;
      const sitekey = document.querySelector('.h-captcha, .g-recaptcha')?.getAttribute('data-sitekey') || '';
      return { hasRecaptcha, hasHcaptcha, sitekey };
    });
    console.log(`${board}: ${applyUrl} | recaptcha=${captcha.hasRecaptcha} hcaptcha=${captcha.hasHcaptcha} sitekey=${captcha.sitekey.slice(0, 12)}`);
  } catch (err) {
    console.log(`${board}: ERROR ${err.message.split('\n')[0]}`);
  }
}

await browser.close();

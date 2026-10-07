import { chromium } from 'playwright';

const url = 'https://jobs.lever.co/activecampaign/3e093aec-8540-49c7-93f1-719727c1191d/apply';
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);

const info = await page.evaluate(() => {
  const questions = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('input, textarea, select')) {
    if (el.type === 'hidden') continue;
    const visible = el.offsetParent !== null;
    if (!visible) continue;
    const id = el.id;
    const label = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
    const container = el.closest('div, fieldset, label');
    const prompt = [label?.textContent, el.getAttribute('aria-label'), el.getAttribute('placeholder'), container?.textContent]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    const key = `${el.name || el.id || el.type}:${prompt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    questions.push({ tag: el.tagName, type: el.type, name: el.name, required: el.required || el.getAttribute('aria-required') === 'true', prompt });
  }
  return { url: location.href, questions };
});

console.log(JSON.stringify(info, null, 2));
await browser.close();

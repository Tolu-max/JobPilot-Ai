import { chromium } from 'playwright';

async function main() {
  console.log('Testing Playwright Chromium launch...');
  const browser = await chromium.launch({ headless: true });
  console.log('Success! Browser version:', browser.version());
  const page = await browser.newPage();
  await page.goto('https://example.com');
  console.log('Page title:', await page.title());
  await browser.close();
  console.log('Browser test completed successfully.');
}

main().catch((err) => {
  console.error('Launch failed:', err);
  process.exit(1);
});

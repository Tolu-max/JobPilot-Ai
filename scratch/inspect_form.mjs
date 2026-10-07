import playwright from 'playwright';

async function main() {
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Navigating to OpenRouter Ashby...');
  await page.goto('https://jobs.ashbyhq.com/openrouter/7088bf7a-6ed7-4c35-bd61-6303e712205c/application', {
    waitUntil: 'networkidle',
    timeout: 45000
  });
  await page.waitForTimeout(4000);
  const title = await page.title();
  console.log('Title:', title);

  console.log('Filling #_systemfield_email...');
  await page.fill('#_systemfield_email', 'toluoyelola066@gmail.com');
  const val = await page.locator('#_systemfield_email').inputValue();
  console.log('Value after fill:', val);

  await browser.close();
}

main().catch(console.error);

import { chromium } from 'playwright';

async function testWellfound() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  
  console.log('Navigating to wellfound.com/jobs...');
  const response = await page.goto('https://wellfound.com/jobs', { waitUntil: 'domcontentloaded' });
  
  console.log('Status:', response.status());
  const title = await page.title();
  console.log('Title:', title);
  
  if (title.includes('Just a moment') || title.includes('Cloudflare')) {
    console.log('BLOCKED BY CLOUDFLARE');
  } else {
    console.log('SUCCESS!');
    const body = await page.innerText('body');
    console.log('Body prefix:', body.slice(0, 200));
  }
  
  await browser.close();
}

testWellfound().catch(console.error);

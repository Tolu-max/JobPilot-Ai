import { chromium } from 'playwright';
import ashbyAdapter from '../src/adapters/ashby.js';
import { buildConfig } from '../src/config.js';

async function run() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  const applyUrl = `https://jobs.ashbyhq.com/n8n/c946f917-c8fb-4e1d-be79-d56ec485ce4e/application`;
  console.log(`Applying to: ${applyUrl}`);
  await page.goto(applyUrl);

  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  const ctx = {
    job: { title: 'Test Job', company: 'Close.com' },
    config: buildConfig(['node', 'jobpilot', '--profile=tolu']),
    candidate: {
      name: 'Tolu Max',
      email: 'tolu@example.com',
      phone: '+234800000000',
      location: 'Nigeria',
      linkedin: 'https://linkedin.com/in/tolumax',
      summary: 'Experienced software engineer.',
      experience: '5 years of full-stack engineering.',
      skills: ['JavaScript', 'Node.js', 'React']
    },
    answers: {},
    resumePath: null
  };

  ctx.config.testMode = true; // Prevent actual submission

  console.log('Calling Ashby adapter fillStep...');
  try {
    await ashbyAdapter.fillStep(page, 'DETAILS', ctx);
    console.log('Fill step completed. Check the browser to see the AI answers!');
    
    // Check what was filled
    const textareas = await page.locator('textarea:visible').all();
    for (const ta of textareas) {
      const val = await ta.inputValue();
      console.log(`Textarea filled: ${val}`);
    }
  } catch (err) {
    console.error('Adapter error:', err);
  }

  // Keep browser open for a few seconds to review
  await page.waitForTimeout(5000);
  await browser.close();
}

run().catch(console.error);

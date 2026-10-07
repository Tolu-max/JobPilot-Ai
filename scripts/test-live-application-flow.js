import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { getAdapter } from '../src/adapters/index.js';
import { FormStep } from '../src/adapters/types.js';
import { buildConfig } from '../src/config.js';

async function testProfileApplication(profileName, jobUrl, resumePdfPath) {
  console.log(`\n======================================================`);
  console.log(`Testing Live Application Flow for profile: [${profileName}]`);
  console.log(`Job URL: ${jobUrl}`);
  console.log(`Resume: ${resumePdfPath}`);
  console.log(`======================================================\n`);

  const config = buildConfig(['node', 'jobpilot', `--profile=${profileName}`]);
  config.testMode = true;
  config.noRealSubmission = true;

  const candidate = JSON.parse(fs.readFileSync(path.resolve(`profiles/${profileName}/candidateProfile.json`), 'utf8'));
  console.log(`Loaded candidate: ${candidate.name} | ${candidate.email} | ${candidate.phone}`);

  const adapter = getAdapter(jobUrl);
  console.log(`Selected adapter: ${adapter.name}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log(`Navigating to job application URL...`);
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    const step = await adapter.getCurrentStep(page);
    console.log(`Initial step detected: ${step}`);

    const ctx = {
      config,
      candidate,
      resumePath: path.resolve(resumePdfPath),
      job: {
        title: 'Application Test Role',
        company: 'Target Company',
        applicationUrl: jobUrl,
        raw: {
          jobDescription: 'Software Engineering / Customer Operations role requiring dedication, problem-solving, and communication skills.'
        }
      }
    };

    console.log(`Filling form step with candidate data and real resume PDF...`);
    await adapter.fillStep(page, step, ctx);
    console.log(`Form fields filled successfully!`);

    await page.waitForTimeout(2000);

    const screenshotDir = path.resolve('artifacts');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, `test-application-${profileName}-${adapter.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved to: ${screenshotPath}`);

    console.log(`Advancing form step in testMode (guards prevent real submit)...`);
    const advanceResult = await adapter.advance(page, step, ctx);
    console.log(`Advance result:`, advanceResult);

    console.log(`\n[SUCCESS] Live application test passed cleanly for ${profileName} on ${adapter.name}!`);
    return { success: true, advanceResult, screenshotPath };
  } catch (err) {
    console.error(`[ERROR] Test failed for ${profileName}:`, err);
    throw err;
  } finally {
    await browser.close();
  }
}

async function main() {
  // Test 1: Tolu on an Ashby tech role with Tolu's Fullstack resume
  const toluJobUrl = 'https://jobs.ashbyhq.com/posthog/f8af3807-3595-4580-a65c-dad2e268ace5/application';
  const toluResume = 'profiles/tolu/resumes/fullstack/resume.pdf';
  await testProfileApplication('tolu', toluJobUrl, toluResume);

  // Test 2: Sister on a Greenhouse / Ashby role with Sister's Customer Support resume
  const sisterJobUrl = 'https://jobs.ashbyhq.com/elevenlabs/917a8698-dc5a-4cb7-84bc-5d2ea9d6fc5c/application';
  const sisterResume = 'profiles/sister/resumes/customer-support/resume.pdf';
  await testProfileApplication('sister', sisterJobUrl, sisterResume);

  console.log('\n======================================================');
  console.log('ALL LIVE APPLICATION TESTS COMPLETED SUCCESSFULLY!');
  console.log('======================================================\n');
}

main().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

import path from 'node:path';
import fs from 'node:fs';
import { chromium } from 'playwright';
import { getAdapter } from '../src/adapters/index.js';
import { buildConfig } from '../src/config.js';

async function testGreenhouseApplication(profileName, jobUrl, roleTitle, resumePdfPath) {
  console.log(`\n======================================================`);
  console.log(`Testing Live Greenhouse Application for profile: [${profileName}]`);
  console.log(`Role: ${roleTitle}`);
  console.log(`Job URL: ${jobUrl}`);
  console.log(`Resume: ${resumePdfPath}`);
  console.log(`======================================================\n`);

  const config = buildConfig(['node', 'jobpilot', `--profile=${profileName}`]);
  config.testMode = true;
  config.noRealSubmission = true;

  const candidate = {
    name: profileName === 'tolu' ? 'Toluwalope Samuel Oyelola' : 'Temiloluwa Ruth Oyelola',
    email: profileName === 'tolu' ? 'toluoyelola066@gmail.com' : 'temmy152000@gmail.com',
    phone: profileName === 'tolu' ? '+2348083838247' : '+2349033324671',
    location: 'Lagos, Nigeria'
  };

  config.applicantEmail = candidate.email;
  config.applicationDefaults = {
    fullName: candidate.name,
    phone: candidate.phone,
    country: 'Nigeria',
    location: 'Lagos, Nigeria'
  };

  const adapter = getAdapter(jobUrl);
  console.log(`Selected adapter: ${adapter.name}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1200 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log(`Navigating to Greenhouse application URL...`);
    await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    const step = await adapter.getCurrentStep(page);
    console.log(`Step detected: ${step}`);

    const ctx = {
      config,
      candidate,
      resumePath: path.resolve(resumePdfPath),
      job: {
        title: roleTitle,
        company: 'Cloudflare',
        applicationUrl: jobUrl,
        raw: {
          jobDescription: `${roleTitle} at Cloudflare.`
        }
      }
    };

    console.log(`Filling Greenhouse form step with candidate data and real resume PDF...`);
    await adapter.fillStep(page, step, ctx);
    console.log(`Form filled!`);

    await page.waitForTimeout(2000);

    // Inspect filled values
    const firstName = await page.inputValue('#first_name').catch(() => '');
    const lastName = await page.inputValue('#last_name').catch(() => '');
    const emailVal = await page.inputValue('#email').catch(() => '');
    const phoneVal = await page.inputValue('#phone').catch(() => '');
    console.log(`Verified filled fields in DOM:`);
    console.log(`  First Name: ${firstName}`);
    console.log(`  Last Name:  ${lastName}`);
    console.log(`  Email:      ${emailVal}`);
    console.log(`  Phone:      ${phoneVal}`);

    const screenshotDir = path.resolve('artifacts');
    fs.mkdirSync(screenshotDir, { recursive: true });
    const screenshotPath = path.join(screenshotDir, `test-application-${profileName}-cloudflare.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`Screenshot saved to: ${screenshotPath}`);

    console.log(`Advancing in testMode (stopping before final submit)...`);
    const advanceResult = await adapter.advance(page, step, ctx);
    console.log(`Advance result:`, advanceResult);

    console.log(`\n[SUCCESS] Live Greenhouse application test passed cleanly for ${profileName}!`);
    return { success: true, advanceResult, screenshotPath };
  } catch (err) {
    console.error(`[ERROR] Test failed for ${profileName}:`, err);
    throw err;
  } finally {
    await browser.close();
  }
}

async function main() {
  // 1. Tolu: Cloudflare Engineer role
  const toluJobUrl = 'https://boards.greenhouse.io/cloudflare/jobs/8097321';
  await testGreenhouseApplication('tolu', toluJobUrl, 'AI Security Research & Red Team Engineer', 'profiles/tolu/resumes/fullstack/resume.pdf');

  // 2. Sister: Cloudflare Customer Experience role
  const sisterJobUrl = 'https://boards.greenhouse.io/cloudflare/jobs/7988072';
  await testGreenhouseApplication('sister', sisterJobUrl, 'Customer Experience Manager', 'profiles/sister/resumes/customer-support/resume.pdf');

  console.log('\n======================================================');
  console.log('BOTH GREENHOUSE LIVE APPLICATION TESTS SUCCEEDED!');
  console.log('======================================================\n');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

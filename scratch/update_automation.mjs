import fs from 'node:fs';

let content = fs.readFileSync('src/automation.js', 'utf8');
const isCrlf = content.includes('\r\n');
const eol = isCrlf ? '\r\n' : '\n';

// 1. Update inspectFormSafety
const targetInspect = [
  'async function inspectFormSafety(page) {',
  "  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');",
  '  if (isBotProtectionText(bodyText)) {'
].join(eol);

const replaceInspect = [
  'async function inspectFormSafety(page) {',
  "  let bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');",
  '  if (isBotProtectionText(bodyText)) {',
  '    for (let i = 0; i < 3; i++) {',
  '      await page.waitForTimeout(2500);',
  "      bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');",
  '      if (!isBotProtectionText(bodyText)) break;',
  '    }',
  '  }',
  '  if (isBotProtectionText(bodyText)) {'
].join(eol);

// 2. Update page.goto navigation in attemptApplication
const targetGoto = [
  '    await page.goto(job.applicationUrl, {',
  "      waitUntil: config.navigationWaitUntil || 'domcontentloaded',",
  '      timeout: Number.parseInt(config.navigationTimeoutMs, 10) || 45000',
  '    });',
  '    await humanDelay(config);',
  '    page = await openApplicationFormIfNeeded(page, config);'
].join(eol);

const replaceGoto = [
  '    await page.goto(job.applicationUrl, {',
  "      waitUntil: config.navigationWaitUntil || 'domcontentloaded',",
  '      timeout: Number.parseInt(config.navigationTimeoutMs, 10) || 45000',
  '    });',
  '    await humanDelay(config);',
  '',
  '    let initialBody = await page.locator(\'body\').innerText({ timeout: 2500 }).catch(() => \'\');',
  '    if (isBotProtectionText(initialBody)) {',
  '      for (let attempt = 0; attempt < 3; attempt++) {',
  '        await page.waitForTimeout(2500);',
  '        initialBody = await page.locator(\'body\').innerText({ timeout: 2500 }).catch(() => \'\');',
  '        if (!isBotProtectionText(initialBody)) break;',
  '      }',
  '    }',
  '',
  '    page = await openApplicationFormIfNeeded(page, config);'
].join(eol);

if (!content.includes(targetInspect)) {
  console.error('Target inspect not found!');
  process.exit(1);
}
if (!content.includes(targetGoto)) {
  console.error('Target goto not found!');
  process.exit(1);
}

content = content.replace(targetInspect, replaceInspect);
content = content.replace(targetGoto, replaceGoto);

fs.writeFileSync('src/automation.js', content, 'utf8');
console.log('Successfully updated src/automation.js');

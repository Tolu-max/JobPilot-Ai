import fs from 'node:fs';

let content = fs.readFileSync('src/automation.js', 'utf8');
const isCrlf = content.includes('\r\n');
const eol = isCrlf ? '\r\n' : '\n';

const oldSection = [
  '    const formSafety = await inspectFormSafety(page);',
  '    if (!formSafety.ok) {',
  '      if (formSafety.captcha) {',
  '        const captchaResult = await waitForCaptchaSolve(page, config, job, debug);',
  '        if (!captchaResult.ok) {',
  '          finalizeApplication(lifecycle, ApplicationState.NEEDS_MANUAL_REVIEW, captchaResult.reason, captchaResult);',
  "          await saveDebugArtifacts(page, debug, '07-after-submit');",
  '          await writeLifecycle(debug, lifecycle);',
  '          return resultFromLifecycle(lifecycle, debug);',
  '        }',
  '      } else {',
  '        const state = formSafety.manualReview ? ApplicationState.NEEDS_MANUAL_REVIEW : ApplicationState.FAILED;',
  '        finalizeApplication(lifecycle, state, formSafety.reason, formSafety);',
  "        await saveDebugArtifacts(page, debug, '07-after-submit');",
  '        await writeLifecycle(debug, lifecycle);',
  '        return resultFromLifecycle(lifecycle, debug);',
  '      }',
  '    }',
  '',
  '    // Navigate through all form steps (multi-step or single-step forms)',
  '    // Adapter selection: site-specific adapters (e.g. bruntwork) use their own',
  '    // step-by-step navigation + proof check + ground-truth re-verification.',
  '    // Generic adapter falls back to navigateMultiStepForm for everything else.',
  '    const adapter = getAdapter(job.applicationUrl || page.url());',
  "    const useSiteAdapter = adapter.name !== 'generic';",
  '',
  '    if (useSiteAdapter) {',
  '      console.log(`[Automation] Using site-specific adapter: ${adapter.name}`);',
  '      const adapterResult = await runSiteAdapterFlow({',
  '        adapter,',
  '        page,',
  '        config,',
  '        coverLetterText,',
  '        applicationAnswers,',
  '        job,',
  '        selectedResume,',
  '        debug,',
  '        lifecycle',
  '      });',
  '      await writeLifecycle(debug, lifecycle);',
  '      return adapterResult;',
  '    }'
].join(eol);

const newSection = [
  '    // Adapter selection: site-specific adapters (e.g. bruntwork, indeed) use their own',
  '    // step-by-step navigation + proof check + ground-truth re-verification.',
  '    const adapter = getAdapter(job.applicationUrl || page.url());',
  "    const useSiteAdapter = adapter.name !== 'generic';",
  '',
  '    if (useSiteAdapter) {',
  '      console.log(`[Automation] Using site-specific adapter: ${adapter.name}`);',
  '      const adapterResult = await runSiteAdapterFlow({',
  '        adapter,',
  '        page,',
  '        config,',
  '        coverLetterText,',
  '        applicationAnswers,',
  '        job,',
  '        selectedResume,',
  '        debug,',
  '        lifecycle',
  '      });',
  '      await writeLifecycle(debug, lifecycle);',
  '      return adapterResult;',
  '    }',
  '',
  '    // Generic fallback: inspect form safety before filling unmapped forms',
  '    const formSafety = await inspectFormSafety(page);',
  '    if (!formSafety.ok) {',
  '      if (formSafety.captcha) {',
  '        const captchaResult = await waitForCaptchaSolve(page, config, job, debug);',
  '        if (!captchaResult.ok) {',
  '          finalizeApplication(lifecycle, ApplicationState.NEEDS_MANUAL_REVIEW, captchaResult.reason, captchaResult);',
  "          await saveDebugArtifacts(page, debug, '07-after-submit');",
  '          await writeLifecycle(debug, lifecycle);',
  '          return resultFromLifecycle(lifecycle, debug);',
  '        }',
  '      } else {',
  '        const state = formSafety.manualReview ? ApplicationState.NEEDS_MANUAL_REVIEW : ApplicationState.FAILED;',
  '        finalizeApplication(lifecycle, state, formSafety.reason, formSafety);',
  "        await saveDebugArtifacts(page, debug, '07-after-submit');",
  '        await writeLifecycle(debug, lifecycle);',
  '        return resultFromLifecycle(lifecycle, debug);',
  '      }',
  '    }'
].join(eol);

if (!content.includes(oldSection)) {
  console.error('Target section not found!');
  process.exit(1);
}

content = content.replace(oldSection, newSection);
fs.writeFileSync('src/automation.js', content, 'utf8');
console.log('Successfully reordered adapter selection before generic formSafety in src/automation.js');

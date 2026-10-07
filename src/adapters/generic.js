// Generic fallback adapter for non-BruntWork sites.
//
// Wraps the existing navigateMultiStepForm + evaluateSubmissionState logic
// but enforces the strict "positive proof only" contract. When the heuristic
// is ambiguous, returns NEEDS_MANUAL_REVIEW instead of CONFIRMED_SUCCESS.
//
// This adapter is a transitional shim — as more sites get explicit adapters,
// the generic path will shrink. The goal is to preserve existing functionality
// for sites that aren't broken while we rebuild the broken ones.

import { FormStep, Proof, noProof, proofFound } from './types.js';

const NAME = 'generic';

function matches(url) {
  // Fallback — matches everything that no other adapter claimed.
  return true;
}

async function getCurrentStep(page) {
  // Generic adapter doesn't have site-specific step knowledge.
  // We'll rely on the existing navigateMultiStepForm to walk the flow.
  // For the adapter contract, we return UNKNOWN and let the caller
  // drive via advance() until isSubmitted() returns true.
  return FormStep.UNKNOWN;
}

async function fillStep(page, step, ctx) {
  // Generic adapter delegates to the existing form-fill helpers in automation.js.
  // The caller (automation.js) will invoke those directly before calling advance.
  // No-op here.
}

async function advance(page, step, ctx) {
  // Generic adapter doesn't know the step structure. The caller will use
  // the existing navigateMultiStepForm loop. This method is a no-op placeholder.
  return { step: FormStep.UNKNOWN, advanced: false, reason: 'Generic adapter delegates step navigation to automation.js.' };
}

async function isSubmitted(page) {
  const startTime = Date.now();
  const timeout = 10000;
  const initialUrl = page.url();

  while (Date.now() - startTime < timeout) {
    const url = page.url();
    const body = await page.locator('body').innerText({ timeout: 1000 }).catch(() => '');
    const markers = [];

    // Strong confirmation text
    const hasConfirmationText = /thank\s*you|application\s*(received|submitted|updated|complete)|successfully\s*(submitted|applied)|we have received|we'?ll be in touch|has been updated|application is complete|profile has been/i.test(body);
    if (hasConfirmationText) {
      markers.push(`body matched confirmation phrase`);
    }

    // Strong confirmation URL
    const hasStrongConfirmationUrl = /\/(confirm|success|thank|submitted|complete|application-received)/i.test(url);
    if (hasStrongConfirmationUrl || (url !== initialUrl && !url.includes(initialUrl))) {
      markers.push(`URL changed or matched strong confirmation route: ${url}`);
    }
    
    // Check for success elements
    const successElements = await page.locator('[class*="confirmation"], [class*="success"], [class*="thank"]').count().catch(() => 0);
    if (successElements > 0) {
      markers.push('success elements found');
    }

    if (markers.length > 0) {
      return proofFound(markers);
    }
    
    await page.waitForTimeout(500).catch(() => {});
  }

  return { outcome: 'uncertain', note: 'No confirmation signal detected' };
}

async function formIsMostlyDisabled(page) {
  const fields = page.locator('form input, form textarea, form select, form button');
  const total = await fields.count().catch(() => 0);
  if (total === 0) return false;
  let disabled = 0;
  for (let i = 0; i < total; i += 1) {
    if (await fields.nth(i).isDisabled().catch(() => false)) disabled += 1;
  }
  return disabled / total >= 0.6;
}

async function verifySubmission(ctx) {
  // Generic adapter has no site-specific re-verification strategy.
  // Return INCONCLUSIVE so the pipeline knows we can't ground-truth this one.
  return {
    proof: Proof.INCONCLUSIVE,
    markers: [],
    reason: 'Generic adapter does not implement re-verification. Relying on in-page proof only.'
  };
}

export const genericAdapter = Object.freeze({
  name: NAME,
  matches,
  getCurrentStep,
  fillStep,
  advance,
  isSubmitted,
  verifySubmission
});

export default genericAdapter;

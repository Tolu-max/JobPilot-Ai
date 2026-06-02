// Strict per-site adapter contract.
//
// Core principle: a job is `applied` only when there is POSITIVE proof of
// submission. Absence of failure is not proof. URL changes are not proof.
// 2xx network responses are not proof. The only acceptable proofs are:
//   - Adapter's isSubmitted() returns true (positive marker on page), AND
//   - Adapter's verifySubmission() returns CONFIRMED (re-visit ground truth).
//
// Background: the previous heuristic-based confirmation layer caused 7/7
// false-positive applies on BruntWork on 2026-05-30 (see audit/recon-bruntwork-*).
// The bot mistook step-1 "Continue" for the final submit.

export const FormStep = Object.freeze({
  EMAIL: 'EMAIL',           // First step: usually just an email field
  DETAILS: 'DETAILS',        // Main step: personal info + resume + questions
  CAPTCHA: 'CAPTCHA',        // Captcha-only gate
  REVIEW: 'REVIEW',          // Review-before-submit gate
  SUBMITTED: 'SUBMITTED',    // Final success page rendered
  ERROR: 'ERROR',            // Visible validation/error state
  UNKNOWN: 'UNKNOWN'         // Adapter could not classify
});

export const Proof = Object.freeze({
  CONFIRMED: 'CONFIRMED',      // Re-verification proved the submission stuck
  NOT_SUBMITTED: 'NOT_SUBMITTED', // Re-verification proved the submission did NOT stick
  INCONCLUSIVE: 'INCONCLUSIVE' // Re-verification could not determine either way
});

/**
 * @typedef {Object} ApplyContext
 * @property {object} config        — runtime config (env-driven flags etc.)
 * @property {object} candidate     — cv-data style object: name/email/phone/...
 * @property {string} resumePath    — absolute path to candidate's PDF resume
 * @property {string} coverLetter   — pre-generated cover letter text
 * @property {object} answers       — pre-generated long-form answers
 * @property {object} job           — job record (title, applicationUrl, etc.)
 * @property {string} debugDir      — where to save adapter-specific artifacts
 */

/**
 * @typedef {Object} StepResult
 * @property {string} step              — value from FormStep
 * @property {boolean} advanced         — true if click actually moved us to a new step
 * @property {string} [reason]          — human-readable note when something abnormal happened
 * @property {object} [meta]            — adapter-specific extras for the log/lifecycle
 */

/**
 * @typedef {Object} SubmittedCheck
 * @property {boolean} submitted        — true only if a POSITIVE success marker was seen
 * @property {string[]} markers         — list of markers that fired (for audit)
 * @property {string} [reason]          — note when submitted=false
 */

/**
 * @typedef {Object} VerifyResult
 * @property {string} proof             — value from Proof
 * @property {string[]} markers         — list of markers that fired (for audit)
 * @property {string} [reason]          — explanation when not CONFIRMED
 */

/**
 * @typedef {Object} SiteAdapter
 * @property {string} name                                       — short id
 * @property {(url: string) => boolean} matches                  — does this adapter handle this URL?
 * @property {(page: import('playwright').Page) => Promise<string>} getCurrentStep  — returns FormStep value
 * @property {(page: import('playwright').Page, step: string, ctx: ApplyContext) => Promise<void>} fillStep  — fills the given step
 * @property {(page: import('playwright').Page, step: string, ctx: ApplyContext) => Promise<StepResult>} advance  — clicks the step's progress button
 * @property {(page: import('playwright').Page) => Promise<SubmittedCheck>} isSubmitted  — positive proof check
 * @property {(ctx: ApplyContext) => Promise<VerifyResult>} verifySubmission  — ground-truth re-check (independent browser/context if needed)
 */

// Helper: a check result that explicitly says "no proof found, do not assume success."
export function noProof(reason) {
  return { submitted: false, markers: [], reason: reason || 'No positive submission marker detected.' };
}

export function proofFound(markers, reason) {
  return { submitted: true, markers: Array.isArray(markers) ? markers : [String(markers)], reason: reason || '' };
}

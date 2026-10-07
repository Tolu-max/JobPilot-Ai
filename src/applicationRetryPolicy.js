// Application outcomes that are deterministic for a specific job/form and
// must not be sent back through the scheduler's transient retry budget.
// Keep this separate from pipeline/Telegram modules to avoid a circular import.
export function isDeterministicApplicationFailure(reason = '') {
  const text = String(reason || '');
  return /(?:very\s+)?complex\s+form|\brequired\s+fields?\b.*\bmanual\s+review\b|unknown\s+ats|manual\s+review\s+required|captcha|recaptcha|hcaptcha|same-indeed-page|no external apply URL found|no longer accepting applications|applications?\s+(?:are|is)\s+closed|(?:job|role|position)\s+(?:is |has been )?(?:closed|unavailable)/i.test(text);
}

export const maxRetries = 3;

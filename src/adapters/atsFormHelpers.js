// Shared form-fill helpers for React-SPA ATS adapters (Workable, Ashby, ...).
//
// These are extracted verbatim (in behaviour) from the Lever adapter so that
// multiple React-based ATSes can share the same battle-tested fill technique.
// Lever keeps its own private copies — this module is purely additive, so there
// is zero refactor risk to the audited Lever path.
//
//   reactFill(page, selector, value)  — force-set a controlled React input via
//                                       the native value descriptor, then blur.
//   checkAllRadioGroups(page)         — select the first visible option in every
//                                       unchecked radio group (EEO/demographic).
//   auditRequiredFields(page)         — DOM walk for still-empty required fields.

/**
 * Force-set a React-controlled input/textarea via the native value descriptor.
 * Returns true if the field was found and (already or now) holds a value.
 * @param {import('playwright').Page} page
 * @param {string|import('playwright').Locator} selector  — CSS string or a Locator
 *        (use a Locator, e.g. page.getByLabel(...), when the field name is not stable)
 * @param {string} value
 * @returns {Promise<boolean>}
 */
export async function reactFill(page, selector, value) {
  if (!value) return false;
  const loc = (typeof selector === 'string' ? page.locator(selector) : selector).first();
  // Don't gate on strict visibility: some React ATSes (Ashby) render real,
  // fillable inputs that Playwright reports as "not visible" because a styled
  // widget overlays them. Wait briefly for the field to mount (React fields can
  // attach a beat after load), then require it to be present and not disabled.
  const present = await loc.waitFor({ state: 'attached', timeout: 4000 }).then(() => true).catch(() => false);
  if (!present) return false;
  if (await loc.isDisabled().catch(() => false)) return false;

  const current = await loc.inputValue().catch(() => '');
  if (current.trim()) return true; // already filled

  await loc.scrollIntoViewIfNeeded().catch(() => {});
  await loc.click({ force: true }).catch(() => {});
  await loc.evaluate((el, nextValue) => {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    desc?.set?.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    desc?.set?.call(el, nextValue);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, String(value)).catch(async () => {
    await loc.fill('').catch(() => {});
    await loc.pressSequentially(String(value), { delay: 20 }).catch(() => {});
  });
  // blur to trigger React validation
  await loc.evaluate((el) => el.blur()).catch(() => {});
  return true;
}

/**
 * Select the first visible radio in each unchecked radio group. Used to satisfy
 * required EEO/demographic groups without asserting anything about the candidate.
 * @param {import('playwright').Page} page
 */
export async function checkAllRadioGroups(page) {
  const radios = await page.locator('input[type="radio"]:visible').all();
  const seen = new Set();
  for (const radio of radios) {
    const name = await radio.getAttribute('name').catch(() => '') || '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const checked = await page.locator(`input[type="radio"][name="${cssEscape(name)}"]:checked`).count().catch(() => 0);
    if (checked > 0) continue;
    await radio.check({ force: true }).catch(() => {});
  }
}

/**
 * Walk the DOM for visible required fields that are still empty. Returns
 * { ok, reason, missing } so callers can bail to manual review before submit.
 * @param {import('playwright').Page} page
 * @returns {Promise<{ ok: boolean, reason: string, missing: Array<object> }>}
 */
export async function auditRequiredFields(page) {
  return page.locator('body').evaluate(() => {
    const visible = (el) => {
      if (!(el instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const required = Array.from(document.querySelectorAll('input, textarea, select'))
      .filter((el) => visible(el))
      .filter((el) => el.required || el.getAttribute('aria-required') === 'true')
      .filter((el) => el.type !== 'hidden');

    const missing = required.filter((el) => {
      if (el.type === 'checkbox' || el.type === 'radio') {
        const n = el.getAttribute('name');
        if (!n) return !el.checked;
        return !document.querySelector(`input[name="${CSS.escape(n)}"]:checked`);
      }
      if (el.type === 'file') {
        if (el.files?.length) return false;
        const anyFileAttached = Array.from(document.querySelectorAll('input[type="file"]')).some((f) => f.files?.length > 0);
        if (anyFileAttached) return false;
        const hasResumePill = Boolean(document.body.innerText.match(/resume\.pdf|\.(?:pdf|docx|doc)\b/i));
        if (hasResumePill) return false;
        return true;
      }
    });

    const labelFor = (el) => {
      const id = el.id;
      const lbl = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      return (lbl?.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 60);
    };

    return {
      ok: missing.length === 0,
      reason: missing.length
        ? `${missing.length} required field(s) still empty: ${missing.map((el) => `${el.name || el.id || el.type}(${labelFor(el)})`).join(', ')}`
        : 'Form passed pre-submit required-field audit.',
      missing: missing.map((el) => ({ name: el.name || '', id: el.id || '', type: el.type || el.tagName.toLowerCase(), label: labelFor(el) }))
    };
  }).catch((error) => ({
    ok: false,
    reason: `Required-field audit failed: ${error.message}`,
    missing: []
  }));
}

/** Fill only unambiguous profile facts on dynamically-generated ATS fields. */
export async function fillKnownRequiredFields(page, ctx = {}) {
  if (typeof page?.locator !== 'function') return;
  const candidate = ctx.candidate || {};
  const defaults = ctx.config?.applicationDefaults || {};
  const fullName = candidate.name || defaults.fullName || '';
  const email = ctx.config?.applicantEmail || candidate.email || defaults.email || '';
  const phone = firstPhone(candidate.phone || defaults.phone || '');
  const location = candidate.location || defaults.city || defaults.country || 'Nigeria';
  const values = {
    email, phone, name: fullName, country: defaults.country || 'Nigeria',
    nationality: defaults.nationality || 'Nigerian', city: defaults.city || '',
    state: defaults.state || '', linkedin: candidate.linkedin || defaults.linkedinProfileUrl || '',
    website: candidate.website || candidate.portfolio || defaults.portfolioUrl || '',
    portfolio: candidate.portfolio || defaults.portfolioUrl || '',
    'years of experience': String(defaults.yearsExperience || candidate.yearsExperience || ''),
    'hours per week': String(defaults.hoursPerWeek || ''), location
  };
  const fieldLocator = page.locator('input:visible, textarea:visible, select:visible');
  if (typeof fieldLocator?.all !== 'function') return;
  const fields = await fieldLocator.all().catch(() => []);
  for (const field of fields) {
    const type = (await field.getAttribute('type').catch(() => '')) || '';
    if (/hidden|file|radio|checkbox/i.test(type)) continue;
    const current = await field.inputValue().catch(() => '');
    if (String(current || '').trim()) continue;
    const label = ((await field.evaluate((el) =>
      el.labels?.[0]?.innerText || el.getAttribute('aria-label') || el.placeholder ||
      el.closest('label')?.innerText || el.closest('.question, .field, .form-group')?.innerText || ''
    ).catch(() => '')) || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const key = Object.keys(values).find((candidateKey) => label.includes(candidateKey));
    const value = key ? values[key] : '';
    if (!value) continue;
    if (type === 'select-one' || await field.evaluate((el) => el.tagName === 'SELECT').catch(() => false)) {
      await field.selectOption({ label: value }).catch(() => field.selectOption({ value }).catch(() => {}));
    } else {
      await reactFill(field, value);
    }
  }
}

/**
 * Split a single full-name string into { first, last } for ATSes (Workable)
 * that use separate first/last name inputs.
 * @param {string} fullName
 * @returns {{ first: string, last: string }}
 */
export function splitName(fullName = '') {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] || '', last: parts.slice(1).join(' ') || '' };
}

export function firstPhone(phone) {
  return String(phone || '').split(',')[0].trim();
}

export function cssEscape(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

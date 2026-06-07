import { appendLog } from './logger.js';

const CAPSOLVER_BASE = 'https://api.capsolver.com';
const CAPTCHASOLV_BASE = 'https://v1.captchasolv.com';

/**
 * Solve a CAPTCHA via token injection.
 * CapSolver is preferred; CaptchaSolv remains a fallback for reCAPTCHA v2.
 */
export async function solveCaptchaAuto(page, config) {
  const captchaSolvKey = config.captchaSolvApiKey || process.env.CAPTCHASOLV_API_KEY;
  const capsolverKey = config.capsolverApiKey || process.env.CAPSOLVER_API_KEY;
  if (!captchaSolvKey && !capsolverKey) {
    return { ok: false, reason: 'CAPTCHASOLV_API_KEY or CAPSOLVER_API_KEY is not configured.' };
  }

  const captchaType = await detectCaptchaType(page);
  await appendLog(`[CaptchaSolver] Detected CAPTCHA type: ${captchaType}`, config);

  if (captchaType !== 'recaptcha2' && captchaType !== 'hcaptcha') {
    return { ok: false, reason: `Unsupported or undetected CAPTCHA type: ${captchaType}` };
  }

  if (capsolverKey) {
    await appendLog('[CaptchaSolver] Attempting CapSolver token injection...', config);
    const result = await solveWithCapSolver(page, captchaType, capsolverKey, config);
    if (result.ok || !captchaSolvKey || captchaType !== 'recaptcha2') return result;
    await appendLog(`[CaptchaSolver] CapSolver failed, falling back to CaptchaSolv: ${result.reason}`, config);
  }

  if (captchaSolvKey && captchaType === 'recaptcha2') {
    await appendLog('[CaptchaSolver] Attempting CaptchaSolv token injection...', config);
    return solveWithCaptchaSolv(page, captchaType, captchaSolvKey, config);
  }

  return { ok: false, reason: `${captchaType} is not supported by configured solver. Add CAPSOLVER_API_KEY.` };
}

// ---------------------------------------------------------------------------
// CaptchaSolv token injection (reCAPTCHA v2)
// ---------------------------------------------------------------------------

async function solveWithCaptchaSolv(page, captchaType, apiKey, config) {
  try {
    const pageUrl = page.url();
    const siteKey = await waitForSiteKey(page, captchaType, 15000);
    if (!siteKey) {
      return { ok: false, reason: 'CaptchaSolv: could not extract a valid site key from page.' };
    }

    const isEnterprise = await isEnterpriseRecaptcha(page);
    const isInvisible = await isInvisibleRecaptcha(page);
    const taskType = captchaSolvTaskType({ isEnterprise, isInvisible });
    console.log(`[CaptchaSolver] CaptchaSolv site key: ${siteKey.slice(0, 12)}... (len=${siteKey.length})`);
    console.log(`[CaptchaSolver] CaptchaSolv task=${taskType}`);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(15000, Number(config?.captchaSolverTimeoutMs || process.env.CAPTCHA_SOLVER_TIMEOUT_MS || 45000))
    );
    try {
      const response = await fetch(`${CAPTCHASOLV_BASE}/solve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          clientKey: apiKey,
          task: {
            type: taskType,
            websiteURL: pageUrl,
            websiteKey: siteKey
          }
        })
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        return { ok: false, reason: `CaptchaSolv HTTP ${response.status}: ${JSON.stringify(data).slice(0, 300)}` };
      }
      if (data.errorId && data.errorId > 0) {
        return { ok: false, reason: `CaptchaSolv error: ${data.errorDescription || data.errorCode || data.errorId}` };
      }

      const token = data.solution?.token || data.solution?.gRecaptchaResponse || data.token;
      if (!token) {
        return { ok: false, reason: 'CaptchaSolv returned no token.' };
      }

      console.log('[CaptchaSolver] CaptchaSolv token received. Injecting...');
      await injectCaptchaToken(page, token, captchaType);
      console.log('[CaptchaSolver] CaptchaSolv token injected successfully.');
      return { ok: true, reason: 'CAPTCHA solved via CaptchaSolv token injection.' };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    return { ok: false, reason: `CaptchaSolv exception: ${err.name === 'AbortError' ? 'request timed out' : err.message}` };
  }
}

function captchaSolvTaskType({ isEnterprise, isInvisible }) {
  if (isEnterprise && isInvisible) return 'RecaptchaV2EnterpriseInvisibleTaskProxyless';
  if (isEnterprise) return 'RecaptchaV2EnterpriseTaskProxyless';
  if (isInvisible) return 'RecaptchaV2InvisibleTaskProxyless';
  return 'RecaptchaV2TaskProxyless';
}

async function isEnterpriseRecaptcha(page) {
  return page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script[src*="recaptcha"]')].map((script) => script.src || '');
    if (scripts.some((src) => /enterprise\.js|recaptcha\/enterprise/i.test(src))) return true;
    if (window.grecaptcha?.enterprise) return true;
    const frames = [...document.querySelectorAll('iframe[src*="recaptcha"]')].map((frame) => frame.src || '');
    return frames.some((src) => /enterprise/i.test(src));
  }).catch(() => false);
}

// ---------------------------------------------------------------------------
// CapSolver token injection (reCAPTCHA v2 + hCaptcha)
// ---------------------------------------------------------------------------

async function solveWithCapSolver(page, captchaType, apiKey, config) {
  // CapSolver runs proxyless, so errors like "Proxy IP banned by target service"
  // or "captcha unsolvable" are transient on their side — a fresh task uses a
  // different solving IP. Retry the whole create+poll a few times before failing.
  const maxAttempts = Math.max(
    1,
    Number(config?.captchaSolverMaxAttempts || process.env.CAPTCHA_SOLVER_MAX_ATTEMPTS || 3)
  );
  let last = { ok: false, reason: 'CapSolver: no attempt made.' };
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    last = await attemptCapSolverOnce(page, captchaType, apiKey, config);
    if (last.ok || !isTransientCapSolverError(last.reason)) return last;
    await appendLog(
      `[CaptchaSolver] CapSolver transient failure (attempt ${attempt}/${maxAttempts}): ${last.reason}`,
      config
    );
    if (attempt < maxAttempts) await page.waitForTimeout(2000);
  }
  return last;
}

export function isTransientCapSolverError(reason = '') {
  return /proxy ip banned|unsolvable|timed out|temporarily|rate.?limit|try again|service unavailable|poll error|gettaskresult|http 5\d\d/i.test(
    String(reason || '')
  );
}

async function attemptCapSolverOnce(page, captchaType, apiKey, config) {
  try {
    const pageUrl = page.url();
    const siteKey = await waitForSiteKey(page, captchaType, 15000);
    if (!siteKey) {
      return { ok: false, reason: 'CapSolver: could not extract a valid site key from page.' };
    }
    console.log(`[CaptchaSolver] CapSolver site key: ${siteKey.slice(0, 12)}... (len=${siteKey.length})`);

    const isInvisible = captchaType === 'recaptcha2' ? await isInvisibleRecaptcha(page) : false;
    const taskType = captchaType === 'hcaptcha'
      ? 'HCaptchaTaskProxyless'
      : 'ReCaptchaV2TaskProxyless';
    if (captchaType === 'recaptcha2') {
      console.log(`[CaptchaSolver] reCAPTCHA v2 invisible=${isInvisible}`);
    }

    const task = { type: taskType, websiteURL: pageUrl, websiteKey: siteKey };
    if (isInvisible) task.isInvisible = true;

    const { response: createRes, data: createData } = await postSolverJson(
      `${CAPSOLVER_BASE}/createTask`,
      { clientKey: apiKey, task },
      config,
      'CapSolver createTask',
      15000
    );

    if (!createRes.ok) {
      return { ok: false, reason: `CapSolver createTask HTTP ${createRes.status}: ${JSON.stringify(createData).slice(0, 300)}` };
    }

    if (createData.errorId > 0) {
      // Retry once with the opposite invisible flag if CapSolver rejected the type
      if (captchaType === 'recaptcha2' && /invisible|captcha type/i.test(createData.errorDescription || '')) {
        console.log(`[CaptchaSolver] Retrying with isInvisible=${!isInvisible}`);
        const retryTask = { type: taskType, websiteURL: pageUrl, websiteKey: siteKey };
        if (!isInvisible) retryTask.isInvisible = true;
        const { response: retryRes, data: retryData } = await postSolverJson(
          `${CAPSOLVER_BASE}/createTask`,
          { clientKey: apiKey, task: retryTask },
          config,
          'CapSolver createTask retry',
          15000
        );
        if (!retryRes.ok) {
          return { ok: false, reason: `CapSolver createTask retry HTTP ${retryRes.status}: ${JSON.stringify(retryData).slice(0, 300)}` };
        }
        if (retryData.errorId > 0) {
          return { ok: false, reason: `CapSolver createTask error: ${retryData.errorDescription}` };
        }
        if (!retryData.taskId) {
          return { ok: false, reason: 'CapSolver createTask retry returned no taskId.' };
        }
        return pollCapSolver(page, retryData.taskId, apiKey, captchaType, config);
      }
      return { ok: false, reason: `CapSolver createTask error: ${createData.errorDescription}` };
    }

    if (!createData.taskId) {
      return { ok: false, reason: 'CapSolver createTask returned no taskId.' };
    }
    return pollCapSolver(page, createData.taskId, apiKey, captchaType, config);
  } catch (err) {
    return { ok: false, reason: `CapSolver exception: ${err.message}` };
  }
}

async function pollCapSolver(page, taskId, apiKey, captchaType, config) {
  console.log(`[CaptchaSolver] CapSolver task created: ${taskId}`);
  const maxPolls = Math.max(1, Math.min(24, Math.ceil(Number(config?.captchaSolverTimeoutMs || process.env.CAPTCHA_SOLVER_TIMEOUT_MS || 45000) / 5000)));
  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const { response: pollRes, data: pollData } = await postSolverJson(
      `${CAPSOLVER_BASE}/getTaskResult`,
      { clientKey: apiKey, taskId },
      config,
      'CapSolver getTaskResult',
      10000
    );

    if (!pollRes.ok) {
      return { ok: false, reason: `CapSolver poll HTTP ${pollRes.status}: ${JSON.stringify(pollData).slice(0, 300)}` };
    }

    if (pollData.errorId > 0) {
      return { ok: false, reason: `CapSolver poll error: ${pollData.errorDescription}` };
    }

    if (pollData.status === 'ready') {
      const token = pollData.solution?.gRecaptchaResponse || pollData.solution?.token;
      if (!token) return { ok: false, reason: 'CapSolver returned ready but no token.' };

      console.log('[CaptchaSolver] CapSolver token received. Injecting...');
      await injectCaptchaToken(page, token, captchaType);
      console.log('[CaptchaSolver] CapSolver token injected successfully.');
      return { ok: true, reason: 'CAPTCHA solved via CapSolver token injection.' };
    }

    console.log(`[CaptchaSolver] CapSolver pending... (attempt ${i + 1}/${maxPolls})`);
  }

  return { ok: false, reason: `CapSolver timed out after ${maxPolls * 5}s.` };
}

async function postSolverJson(url, payload, config, label, timeoutCapMs) {
  const timeoutMs = solverRequestTimeoutMs(config, timeoutCapMs);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } catch (err) {
    const reason = err.name === 'AbortError' ? `timed out after ${timeoutMs}ms` : err.message;
    throw new Error(`${label} ${reason}`);
  } finally {
    clearTimeout(timeout);
  }
}

function solverRequestTimeoutMs(config, timeoutCapMs) {
  const configured = Number(config?.captchaSolverRequestTimeoutMs || config?.captchaSolverTimeoutMs || process.env.CAPTCHA_SOLVER_TIMEOUT_MS || 45000);
  const cap = Number(timeoutCapMs || 15000);
  return Math.max(3000, Math.min(cap, Number.isFinite(configured) && configured > 0 ? configured : 45000));
}

async function isInvisibleRecaptcha(page) {
  try {
    return await page.evaluate(() => {
      const el = document.querySelector('.g-recaptcha[data-size="invisible"], [data-sitekey][data-size="invisible"]');
      if (el) return true;
      const badge = document.querySelector('.grecaptcha-badge');
      if (badge) return true;
      const anchorIframe = document.querySelector('iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]');
      if (anchorIframe && /size=invisible/.test(anchorIframe.src)) return true;
      return false;
    });
  } catch {
    return false;
  }
}

async function extractSiteKey(page, captchaType) {
  return page.evaluate((type) => {
    const RESERVED = new Set(['explicit', 'onload', 'onloadcallback', 'render']);
    const looksLikeKey = (k) => typeof k === 'string' && k.length >= 30 && !RESERVED.has(k);

    // 1. Direct DOM attribute (most common static placement)
    const els = [...document.querySelectorAll('[data-sitekey]')];
    for (const el of els) {
      const k = el.getAttribute('data-sitekey');
      if (looksLikeKey(k)) return k;
    }

    if (type === 'hcaptcha') {
      const hEls = [...document.querySelectorAll('.h-captcha, [data-hcaptcha-widget-id]')];
      for (const el of hEls) {
        const k = el.getAttribute('data-sitekey');
        if (looksLikeKey(k)) return k;
      }
    }

    // 2. iframe ?k= param (works once widget has rendered)
    const iframes = [...document.querySelectorAll('iframe[src*="recaptcha"], iframe[src*="hcaptcha"]')];
    for (const iframe of iframes) {
      const m = iframe.src.match(/[?&]k=([^&]+)/);
      if (m && looksLikeKey(m[1])) return m[1];
    }

    // 3. ___grecaptcha_cfg.clients (set when grecaptcha.render() is called dynamically)
    try {
      const cfg = window.___grecaptcha_cfg;
      if (cfg && cfg.clients) {
        for (const clientId of Object.keys(cfg.clients)) {
          const client = cfg.clients[clientId];
          const queue = [client];
          while (queue.length) {
            const node = queue.shift();
            if (node && typeof node === 'object') {
              for (const v of Object.values(node)) {
                if (typeof v === 'string' && looksLikeKey(v)) return v;
                if (v && typeof v === 'object') queue.push(v);
              }
            }
          }
        }
      }
    } catch {}

    // 4. recaptcha script render param (only if it's a real key, NOT 'explicit')
    const scripts = [...document.querySelectorAll('script[src*="recaptcha"]')];
    for (const s of scripts) {
      const m = s.src.match(/[?&]render=([^&]+)/);
      if (m && looksLikeKey(m[1])) return m[1];
    }

    return null;
  }, captchaType);
}

async function waitForSiteKey(page, captchaType, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastSeen = null;
  while (Date.now() < deadline) {
    const key = await extractSiteKey(page, captchaType);
    if (key) return key;
    lastSeen = key;
    await page.waitForTimeout(500);
  }
  return lastSeen;
}

async function injectCaptchaToken(page, token, captchaType) {
  await page.evaluate(({ token, type }) => {
    console.log('[CaptchaSolver] Starting token injection, token length:', token.length);

    // 1. Set the hidden textarea value (CRITICAL for form validation)
    const textarea = document.querySelector('#g-recaptcha-response, textarea[name="g-recaptcha-response"]');
    if (textarea) {
      // Force set the value multiple ways to ensure it sticks
      textarea.value = token;
      textarea.innerHTML = token;
      textarea.textContent = token;
      textarea.setAttribute('value', token);

      // Dispatch events
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      textarea.dispatchEvent(new Event('input', { bubbles: true }));

      console.log('[CaptchaSolver] Textarea value set, current value length:', textarea.value.length);
    } else {
      console.log('[CaptchaSolver] WARNING: g-recaptcha-response textarea not found!');
    }

    if (type === 'hcaptcha') {
      const hTextarea = document.querySelector('textarea[name="h-captcha-response"]');
      if (hTextarea) {
        hTextarea.value = token;
        hTextarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // 2. Try to find and call the reCAPTCHA callback
    let callbackCalled = false;
    if (window.___grecaptcha_cfg) {
      try {
        const clients = window.___grecaptcha_cfg.clients || {};
        for (const clientId of Object.keys(clients)) {
          const client = clients[clientId];
          // Traverse the client object to find callback functions
          const queue = [client];
          while (queue.length > 0) {
            const node = queue.shift();
            if (node && typeof node === 'object') {
              // Check if this node has a callback
              if (typeof node.callback === 'function') {
                try {
                  node.callback(token);
                  callbackCalled = true;
                  console.log('[CaptchaSolver] Callback called successfully');
                } catch (e) {
                  console.log('[CaptchaSolver] Callback error:', e);
                }
              }
              // Add child objects to queue
              for (const key of Object.keys(node)) {
                const val = node[key];
                if (val && typeof val === 'object' && !Array.isArray(val)) {
                  queue.push(val);
                }
              }
            }
          }
        }
      } catch (e) {
        console.log('[CaptchaSolver] grecaptcha_cfg traversal error:', e);
      }
    }

    // 3. If no callback was found, try alternative methods
    if (!callbackCalled) {
      console.log('[CaptchaSolver] No callback found, trying alternatives');

      // Try window.grecaptcha.getResponse() setter
      if (window.grecaptcha && typeof window.grecaptcha.getResponse === 'function') {
        try {
          const originalGetResponse = window.grecaptcha.getResponse;
          window.grecaptcha.getResponse = function() { return token; };
          console.log('[CaptchaSolver] Overrode grecaptcha.getResponse()');
        } catch (e) {
          console.log('[CaptchaSolver] getResponse override error:', e);
        }
      }

      // Try enterprise execute
      if (window.grecaptcha && window.grecaptcha.enterprise) {
        try {
          window.grecaptcha.enterprise.execute();
          console.log('[CaptchaSolver] Called grecaptcha.enterprise.execute()');
        } catch (e) {
          console.log('[CaptchaSolver] enterprise.execute error:', e);
        }
      }
    }

    // Final verification
    const finalTextarea = document.querySelector('#g-recaptcha-response, textarea[name="g-recaptcha-response"]');
    if (finalTextarea) {
      console.log('[CaptchaSolver] Final textarea value length:', finalTextarea.value.length);
    }
  }, { token, type: captchaType });

  // Wait longer for BruntWork's React state to update
  await page.waitForTimeout(3000);
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

async function detectCaptchaType(page) {
  const anchorLocator = page.locator(
    'iframe[src*="recaptcha/api2/anchor"], iframe[src*="recaptcha/enterprise/anchor"]'
  );
  await anchorLocator.first().waitFor({ timeout: 8000, state: 'attached' }).catch(() => {});

  const hasAnchorIframe = (await anchorLocator.count().catch(() => 0)) > 0;
  const hasRecaptchaEl = (await page.locator('.g-recaptcha, [data-sitekey]').count().catch(() => 0)) > 0;
  const hasRecaptchaScript = (await page.locator('script[src*="recaptcha"]').count().catch(() => 0)) > 0;
  if (hasAnchorIframe || hasRecaptchaEl || hasRecaptchaScript) return 'recaptcha2';

  const hcaptchaLocator = page.locator('iframe[src*="hcaptcha"], .h-captcha');
  await hcaptchaLocator.first().waitFor({ timeout: 3000, state: 'attached' }).catch(() => {});
  const hasHcaptcha = (await hcaptchaLocator.count().catch(() => 0)) > 0;
  if (hasHcaptcha) return 'hcaptcha';

  return 'unknown';
}

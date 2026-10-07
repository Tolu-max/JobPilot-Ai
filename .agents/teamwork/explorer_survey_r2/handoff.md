# Handoff Report: R2 - Indeed Scraper Timeout & Fallback Investigation

## 1. Observation

### Exact File Paths, Line Numbers, and Code Quotes

#### 1.1 Timeout Handling in `src/scrapers/index.js` (lines 209–225, 240–250)
```javascript
209:   const retries = Number.parseInt(siteConfig.retries, 10);
210:   const retryCount = Number.isFinite(retries) ? retries : 1;
211:   const timeoutMs = Number.parseInt(siteConfig.timeoutMs, 10) || 45000;
212: 
213:   return withTimeout(
214:     () =>
215:       withRetry(() => entry.scrape({ ...config, siteJobLimit: siteConfig.maxJobsPerRun }, siteConfig), {
216:         retries: retryCount,
217:         delayMs: Number.parseInt(siteConfig.retryDelayMs, 10) || 3000,
218:         shouldRetry: (error) => ![401, 403].includes(Number(error?.status))
219:       }),
220:     timeoutMs,
221:     `${site} scraper timed out after ${timeoutMs}ms`
222:   );
```
- Line 211 uses fallback `45000` ms if `siteConfig.timeoutMs` is missing.
- When `timeoutMs` triggers, `withTimeout` throws verbatim: `${site} scraper timed out after ${timeoutMs}ms`.

#### 1.2 Origin of the 60,000 ms Timeout in `config/sites.json` (lines 30–37)
```json
30:   "indeed": {
31:     "enabled": true,
32:     "priority": 16,
33:     "maxJobsPerRun": 30,
34:     "cooldownMinutes": 1,
35:     "autoApplyEnabled": true,
36:     "timeoutMs": 60000
37:   },
```
- Line 36 explicitly defines `"timeoutMs": 60000` for `indeed`.
- In `src/config.js` (lines 368–369), `config/sites.json` is loaded as `fileSites`. In the absence of a `timeoutMs` override in `preferenceSites`, `merged[site].timeoutMs` inherits `60000`.

#### 1.3 Missing Timeout & Duplicate Entries in `profiles/tolu/preferences.json`
- Lines 80–85:
```json
80:     "indeed": {
81:       "enabled": true,
82:       "maxJobsPerRun": 30,
83:       "cooldownMinutes": 1,
84:       "autoApplyEnabled": true
85:     },
```
- Lines 294–300:
```json
294:     "indeed": {
295:       "enabled": true,
296:       "maxJobsPerRun": 20,
297:       "maxAgeDays": 14,
298:       "cooldownMinutes": 1,
299:       "autoApplyEnabled": true
300:     },
```
- Neither entry specifies `timeoutMs`.
- There is a duplicate top-level `"indeed"` key inside `"sites"`, with line 294 overwriting line 80 when parsed by `JSON.parse`.
- Because `timeoutMs` is undefined in both, `config/sites.json`'s `60000` value persists as `siteConfig.timeoutMs`.

#### 1.4 Orchestration & Timeouts in `src/scrapers/indeed.js`
- **Search URL Count** (`resolveIndeedSearchUrls`, lines 255–288):
  For developer profiles (Tolu), `resolveIndeedSearchUrls` returns **33 search URLs** (13 US Remote URLs and 20 Nigerian URLs).
- **Bright Data MCP Request Timeout** (`fetchIndeedViaBrightData`, lines 379–386, 404–406):
```javascript
379: export async function fetchIndeedViaBrightData(url, token, options = {}) {
380:   const timeoutMs = options.timeoutMs || 60000;
381:   let sess = options.sessionId;
382:   if (!sess) {
383:     const initResp = await fetch(`https://mcp.brightdata.com/mcp?token=${token}`, {
384:       method: 'POST',
385:       signal: AbortSignal.timeout(timeoutMs),
...
404:   const callResp = await fetch(`https://mcp.brightdata.com/mcp?token=${token}`, {
405:     signal: AbortSignal.timeout(timeoutMs),
```
  Each individual HTTP call (init and scrape) defaults to `60000` ms!
- **Exponential Backoff Loop** (`fetchWithBackoff`, lines 17–30):
```javascript
17: async function fetchWithBackoff(fetchFn, maxRetries = 3) {
18:   for (let i = 0; i < maxRetries; i++) {
19:     try {
20:       return await fetchFn();
21:     } catch (err) {
22:       if (err.message.includes('403') || err.message.includes('429') || err.message.includes('blocked') || err.message.includes('failed')) {
23:         if (i === maxRetries - 1) throw err;
24:         await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000 + Math.random() * 500));
25:       } else {
26:         throw err;
27:       }
28:     }
29:   }
30: }
```
  When Bright Data throws an error containing `'failed'` (e.g., `Bright Data MCP init failed: HTTP 401`), `fetchWithBackoff` retries up to 3 times with exponential backoff (1s, 2s, 4s).
- **Bright Data Loop Mechanics** (lines 455–474):
```javascript
455:         for (const url of searchUrls) {
456:           if (limit > 0 && rawJobs.length >= limit) break;
457:           try {
458:             await this.log(`Fetching Indeed listings via Bright Data MCP: ${url}`);
459:             const result = await fetchWithBackoff(() => fetchIndeedViaBrightData(url, mcpToken, { sessionId: activeSessionId }));
...
470:           } catch (err) {
471:             await this.log(`Bright Data MCP failed on ${url}: ${err.message}`);
472:             activeSessionId = null;
473:           }
474:         }
```
  On failure for a given URL, the loop catches the error at line 470, logs it, and **continues to the next URL** across all 33 URLs without checking elapsed time or aborting early when the MCP service fails repeatedly.
- **Playwright Fallback Loop Mechanics** (lines 508–560):
```javascript
508:       for (const url of searchUrls) {
509:         if (limit > 0 && rawJobs.length >= limit) break;
510:         try {
511:           await this.log(`Fetching Indeed listings: ${url}`);
512:           await fetchWithBackoff(async () => {
513:             const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
...
518:           await page.waitForTimeout(2500);
```
  `page.goto` has a 35-second timeout, followed by a 2.5-second sleep per URL. If multiple URLs are processed, Playwright easily exceeds 60–120 seconds if no deadline check is enforced.

#### 1.5 Scrapers Check Harness & Verification Output
- `npm run scrapers:check` executes `node scripts/check-scrapers.mjs`.
- Current execution output:
```
JobPilot scraper readiness
Registered: 38
Configured: 38
Enabled:    2
Scraper readiness passed.
```
- `node --test test/indeedScraper.test.js test/indeedIntegration.test.js` output:
```
✔ Indeed Integration: fetch, normalize, match, role isolation, and gateway handoff (76.7396ms)
✔ Indeed Scraper: registered in scraperRegistry and marked implemented (3.4298ms)
...
pass 9, fail 0
```

---

## 2. Logic Chain

### 2.1 Why the Scraper Timed Out at 60,000 ms on Railway
1. `config/sites.json:36` sets `"timeoutMs": 60000` for `indeed`.
2. `profiles/tolu/preferences.json` did not define `sites.indeed.timeoutMs`.
3. When `src/config.js` merges preferences, `siteConfig.timeoutMs` became `60000`.
4. In `src/scrapers/index.js:213-224`, `withTimeout` wrapped the scraper execution in a `60000` ms timeout with error message `${site} scraper timed out after ${timeoutMs}ms`.
5. When `fetchJobs()` ran, it attempted to scrape 33 search URLs via Bright Data MCP.
6. In `fetchIndeedViaBrightData`, each request has a 60,000 ms timeout. When Bright Data fails or takes >15s per request, `fetchWithBackoff` retries up to 3 times because the error message contains `'failed'`.
7. The `catch (err)` block on line 470 caught each URL failure and looped to the next URL (up to 33 times).
8. Before the scraper could process more than 1 or 2 URLs, 60,000 ms elapsed.
9. `withTimeout` rejected the entire scrape execution with `Error: indeed scraper timed out after 60000ms`.
10. Because `withTimeout` rejected, the Playwright fallback was aborted or never reached.

### 2.2 Why Playwright Would Also Time Out Without Internal Deadlines
1. If Bright Data fails on URL 1 and 2, taking e.g. 30 seconds before switching to Playwright fallback, only 30 seconds remain (or 90 seconds if timeout is 120,000 ms).
2. Playwright launches chromium and starts iterating through the 33 URLs.
3. Each URL takes:
   - `page.goto` (up to 35,000 ms)
   - `page.waitForTimeout` (2,500 ms)
   - DOM evaluation and parsing
4. Without an internal deadline check, 5–10 URLs in Playwright will exceed 120,000 ms.
5. Therefore, both the Bright Data loop AND the Playwright loop require explicit deadline checks (`Date.now() >= overallDeadline`) to cleanly exit and return all accumulated jobs rather than letting `withTimeout` reject.

### 2.3 Required Orchestration for Graceful Fallback
1. **Reduce Bright Data per-request timeout**: In `fetchIndeedViaBrightData`, change `options.timeoutMs || 60000` to `options.timeoutMs || 15000`. A search listing scrape must complete in 15 seconds.
2. **Circuit breaker for Bright Data MCP**: If Bright Data fails 2 consecutive times (or fails with 401/403/invalid token), break out of the Bright Data loop immediately and fall back to Playwright.
3. **Bright Data time budget**: Bright Data phase should have a strict deadline (e.g. `startTime + 35000` if 0 jobs found). If 35 seconds elapse without jobs, immediately fall back to Playwright.
4. **Overall Scraper Deadline**: Set `overallDeadline = startTime + totalTimeoutMs - 15000` (105,000 ms for a 120,000 ms budget).
5. **Clean URL Skipping**: In both loops, if `Date.now() >= overallDeadline`, log that remaining URLs are being cleanly skipped and `break`. Return accumulated `rawJobs`.
6. **Graceful return**: Returning whatever jobs were collected allows the pipeline to succeed (status `ok`) with 0 errors instead of throwing a timeout exception.

---

## 3. Caveats

1. **Live Bright Data MCP token**: The hardcoded fallback token `'a37e8852-05ae-474d-9b34-0099f2f9aa81'` in `src/scrapers/indeed.js:449` and `src/scrapers/linkedin.js:321` may be expired, rate-limited, or blocked by Cloudflare/Datadome on Indeed. By implementing early circuit breaking, an invalid token will fail quickly (<5–10s) and fall straight to Playwright without causing a scraper timeout.
2. **Network/Proxy environment on Railway**: Playwright on Railway requires headless chromium, which is already configured. Headless stealth and Turnstile bypass are handled in `stealthInit.js` and `adapters/indeed.js`.
3. **Syntax errors in other parts of codebase**: Test suite `npm test` showed failures in `src/telegramBot.js` (line 214) and `test/linkedinScraper.test.js`. These are outside of the Indeed scraper scope and do not affect Indeed scraping or `npm run scrapers:check`.

---

## 4. Conclusion & Answers to Mission Questions

### Q1: Current Timeout Values
| Location | Current Value | Nature / Role |
|---|---|---|
| `src/scrapers/index.js` (~line 211) | `45000` ms | General default scraper timeout |
| `config/sites.json` (line 36) | `60000` ms | Site config value for `indeed` (source of Railway 60s timeout) |
| `profiles/tolu/preferences.json` (lines 80 & 294) | `undefined` (missing) | Duplicate `"indeed"` blocks, neither has `timeoutMs` |
| `src/scrapers/indeed.js` (line 380) | `60000` ms | Per-fetch timeout in `fetchIndeedViaBrightData` |
| `src/scrapers/indeed.js` (line 513) | `35000` ms | Playwright `page.goto` navigation timeout |

### Q2: Current Orchestration & Why Bright Data Failure Causes Timeouts
- Bright Data is invoked in a sequential `for (const url of searchUrls)` loop over 33 URLs.
- Each call uses `fetchWithBackoff` (up to 3 retries) and a 60-second request timeout.
- The `catch (err)` block on line 470 catches failures individually and proceeds to the next URL.
- There is no circuit breaker or elapsed-time check. Retrying failed calls across 33 URLs takes multiple minutes.
- The outer wrapper `withTimeout` in `src/scrapers/index.js` aborts the whole process at 60,000 ms, killing the process before Playwright fallback can run.

### Q3: Graceful Fallthrough from Bright Data MCP to Playwright
- Lower Bright Data per-request timeout to 15,000 ms.
- Limit `fetchWithBackoff` to at most 1 retry and avoid retrying auth errors (401, 403).
- Implement a consecutive failure threshold (2 consecutive failures → break Bright Data loop).
- Implement a Bright Data phase budget (max 35 seconds when 0 jobs collected → break to Playwright).
- Wrap Bright Data execution in `try ... catch` and guarantee flow continues directly to Playwright fallback whenever `rawJobs.length === 0`.

### Q4: Completing / Skipping Remaining URLs Within 120,000 ms
- Establish `overallDeadline = startTime + totalTimeoutMs - 15000` (e.g., 105 seconds).
- In both Bright Data and Playwright loops, evaluate `if (Date.now() >= overallDeadline) break;`.
- Dynamically clamp Playwright `page.goto` timeout to `Math.min(25000, overallDeadline - Date.now())`.
- When deadline is reached or job limit is satisfied, cleanly break the loop, close the browser in `finally`, and return `rawJobs`.

### Q5: Exact Changes to Ensure `npm run scrapers:check` (38/38) Passes
- `scripts/check-scrapers.mjs` checks `config/sites.json` and `scraperRegistry` in `src/scrapers/index.js`.
- Updating `"timeoutMs": 120000` in `config/sites.json` maintains valid JSON with no duplicate keys.
- `scraperRegistry['indeed']` interface `{ scrape: scrapeIndeedJobs, implemented: true }` remains identical.
- Result: 38 registered, 38 configured, 2 enabled (`bruntwork`, `indeed`), 0 failures.

---

## 5. Concrete File-by-File Implementation Plan for Worker

### File 1: `config/sites.json`
- **Location**: Line 36
- **Action**: Update `timeoutMs` for `indeed` from `60000` to `120000`.
```json
  "indeed": {
    "enabled": true,
    "priority": 16,
    "maxJobsPerRun": 30,
    "cooldownMinutes": 1,
    "autoApplyEnabled": true,
    "timeoutMs": 120000
  },
```

### File 2: `profiles/tolu/preferences.json`
- **Location**: In `sites` dictionary (lines 80–85 and lines 294–300)
- **Action**:
  1. Remove duplicate `"indeed"` entry at lines 80–85.
  2. At lines 294–300, set `timeoutMs: 120000`:
```json
    "indeed": {
      "enabled": true,
      "maxJobsPerRun": 20,
      "maxAgeDays": 14,
      "cooldownMinutes": 1,
      "autoApplyEnabled": true,
      "timeoutMs": 120000
    },
```

### File 3: `src/scrapers/index.js`
- **Location**: Line 211
- **Action**: Increase default timeout from 45000 to at least 90000 ms, with 120000 ms for indeed:
```javascript
<<<< CURRENT
  const timeoutMs = Number.parseInt(siteConfig.timeoutMs, 10) || 45000;
==== PROPOSED
  const defaultTimeout = site === 'indeed' ? 120000 : 90000;
  const timeoutMs = Number.parseInt(siteConfig.timeoutMs, 10) || defaultTimeout;
>>>>
```

### File 4: `src/scrapers/indeed.js`
- **Action 1**: In `fetchWithBackoff` (lines 17–30), reduce retries to 2 and do not retry on 401/403:
```javascript
async function fetchWithBackoff(fetchFn, maxRetries = 2) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetchFn();
    } catch (err) {
      if (/401|403|unauthorized|forbidden/i.test(err.message)) throw err;
      if (err.message.includes('429') || err.message.includes('blocked') || err.message.includes('failed')) {
        if (i === maxRetries - 1) throw err;
        await new Promise(r => setTimeout(r, Math.min(2000, Math.pow(2, i) * 1000 + Math.random() * 500)));
      } else {
        throw err;
      }
    }
  }
}
```
- **Action 2**: In `fetchIndeedViaBrightData` (line 380), decrease default request timeout from 60000 to 15000:
```javascript
export async function fetchIndeedViaBrightData(url, token, options = {}) {
  const timeoutMs = options.timeoutMs || 15000;
```
- **Action 3**: In `IndeedScraper.prototype.fetchJobs` (lines 435–569):
  1. Define budget and deadlines at top of `fetchJobs`:
  ```javascript
  const startTime = Date.now();
  const totalTimeoutMs = Number.parseInt(this.siteConfig.timeoutMs, 10) || 120000;
  const safetyBufferMs = 15000;
  const overallDeadline = startTime + totalTimeoutMs - safetyBufferMs;
  ```
  2. In Bright Data block:
  ```javascript
  const brightDataDeadline = startTime + Math.min(35000, Math.floor(totalTimeoutMs * 0.35));
  let consecutiveMcpFailures = 0;

  for (const url of searchUrls) {
    if (limit > 0 && rawJobs.length >= limit) break;
    if (Date.now() >= overallDeadline) {
      await this.log('Approaching scraper deadline during Bright Data phase; stopping search.');
      break;
    }
    if (Date.now() >= brightDataDeadline && rawJobs.length === 0) {
      await this.log('Bright Data MCP budget elapsed with 0 jobs; transitioning to Playwright fallback.');
      break;
    }

    try {
      await this.log(`Fetching Indeed listings via Bright Data MCP: ${url}`);
      const result = await fetchWithBackoff(() => fetchIndeedViaBrightData(url, mcpToken, { sessionId: activeSessionId, timeoutMs: 15000 }));
      activeSessionId = result.sessionId || activeSessionId;
      consecutiveMcpFailures = 0;
      ...
    } catch (err) {
      consecutiveMcpFailures++;
      await this.log(`Bright Data MCP failed on ${url}: ${err.message}`);
      activeSessionId = null;
      if (consecutiveMcpFailures >= 2 && rawJobs.length === 0) {
        await this.log('Bright Data MCP failed consecutively; aborting MCP attempts and falling back to Playwright.');
        break;
      }
    }
  }

  if (rawJobs.length > 0) {
    return rawJobs;
  }
  ```
  3. In Playwright block:
  - Check if enough time remains before launching browser:
  ```javascript
  if (Date.now() + 10000 >= overallDeadline) {
    await this.log('Insufficient time remaining to launch Playwright; returning current results cleanly.');
    return rawJobs;
  }
  ```
  - In Playwright URL loop:
  ```javascript
  for (const url of searchUrls) {
    if (limit > 0 && rawJobs.length >= limit) break;
    if (Date.now() >= overallDeadline) {
      await this.log(`Approaching overall timeout limit (${Math.round((Date.now() - startTime) / 1000)}s elapsed); cleanly completing scraper with ${rawJobs.length} job(s).`);
      break;
    }

    try {
      const remainingTime = Math.max(5000, overallDeadline - Date.now());
      const navTimeout = Math.min(25000, remainingTime);
      await this.log(`Fetching Indeed listings: ${url}`);
      await fetchWithBackoff(async () => {
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: navTimeout });
        if (resp && (resp.status() === 403 || resp.status() === 429)) {
          throw new Error(`Blocked by Indeed with status ${resp.status()}`);
        }
      }, 1);
      await page.waitForTimeout(Math.min(2500, Math.max(500, overallDeadline - Date.now())));
      ...
    }
  ```
  - Ensure `finally` closes the browser cleanly:
  ```javascript
  finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
  ```

---

## 6. Verification Method

To independently verify these changes once implemented by the worker:

1. **Verify Scrapers Readiness Check**:
   ```bash
   npm run scrapers:check
   ```
   *Expected*: Passes with 38 registered, 38 configured, 2 enabled, and 0 failures.

2. **Verify Indeed Unit & Integration Tests**:
   ```bash
   node --test test/indeedScraper.test.js test/indeedIntegration.test.js
   ```
   *Expected*: All 9 tests pass with 0 failures.

3. **Verify Configuration Values**:
   - Check `config/sites.json`: verify `"timeoutMs": 120000` for `indeed`.
   - Check `profiles/tolu/preferences.json`: verify `sites.indeed.timeoutMs` is `120000` and duplicate `"indeed"` key is removed.
   - Check `src/scrapers/index.js`: verify line 211 uses `site === 'indeed' ? 120000 : 90000`.

4. **Simulate Scraper Run with Indeed Enabled**:
   Run dry-run or mock test:
   ```bash
   node -e "import('./src/scrapers/index.js').then(async m => { const res = await m.runScrapers({ profileName: 'tolu', enabledSites: ['indeed'], sites: { indeed: { enabled: true, timeoutMs: 120000, maxJobsPerRun: 5 } } }); console.log('Result:', res.siteResults); })"
   ```
   *Expected*: Completes cleanly without `"indeed scraper timed out after 60000ms"`.

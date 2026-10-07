import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { BaseScraper, normalizeList } from './baseScraper.js';
import { compactText, stripHtml } from '../utils.js';
import { getStealthScript, stealthArgs, stealthUserAgent } from '../stealthInit.js';
import { getPlaywrightProxy } from '../proxyRotator.js';

const MODERN_UAS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0 Safari/537.36'
];

async function fetchWithBackoff(fetchFn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetchFn();
    } catch (err) {
      if (err.message.includes('403') || err.message.includes('429') || err.message.includes('blocked') || err.message.includes('failed')) {
        if (i === maxRetries - 1) throw err;
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000 + Math.random() * 500));
      } else {
        throw err;
      }
    }
  }
}


export async function loadIndeedCookies(profileName = '', config = {}) {
  const possiblePaths = [
    config.indeedCookiesPath,
    profileName ? path.join('profiles', profileName, 'indeed_cookies.json') : null,
    path.join('profiles', 'tolu', 'indeed_cookies.json'),
    path.join('data', 'indeed_cookies.json'),
    profileName ? path.join('data', 'profiles', profileName, 'indeed_cookies.json') : null,
    path.join('data', 'profiles', 'tolu', 'indeed_cookies.json')
  ].filter(Boolean);

  for (const cookiePath of possiblePaths) {
    try {
      const raw = await fs.readFile(cookiePath, 'utf8');
      const cookies = JSON.parse(raw);
      if (Array.isArray(cookies) && cookies.length > 0) {
        const now = Date.now() / 1000;
        return cookies.filter((c) => {
          if (!c.name || !c.value) return false;
          if (c.expirationDate && c.expirationDate < now) return false;
          return true;
        }).map((c) => {
          let sameSite = c.sameSite;
          if (sameSite === 'no_restriction' || sameSite === 'None' || !sameSite) sameSite = 'None';
          else if (sameSite.toLowerCase() === 'lax') sameSite = 'Lax';
          else if (sameSite.toLowerCase() === 'strict') sameSite = 'Strict';

          const cookie = {
            name: c.name,
            value: c.value,
            domain: c.domain,
            path: c.path || '/',
            httpOnly: Boolean(c.httpOnly),
            secure: Boolean(c.secure)
          };
          if (sameSite && (sameSite === 'Strict' || sameSite === 'Lax' || sameSite === 'None')) {
            cookie.sameSite = sameSite;
          }
          if (c.expirationDate) {
            cookie.expires = Math.round(c.expirationDate);
          }
          return cookie;
        });
      }
    } catch {
      // Continue checking next path
    }
  }
  return null;
}

export function parseMosaicJobCards(htmlOrScript) {
  if (!htmlOrScript) return [];
  const text = String(htmlOrScript);
  
  let marker = 'mosaic-provider-jobcards';
  let idx = text.indexOf(marker);
  if (idx !== -1) {
    const eqIdx = text.indexOf('=', idx);
    const startIdx = text.indexOf('{', eqIdx);
    if (startIdx !== -1) {
      let braceCount = 0;
      let endIdx = -1;
      for (let i = startIdx; i < text.length; i++) {
        if (text[i] === '{') braceCount++;
        else if (text[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            endIdx = i + 1;
            break;
          }
        }
      }
      if (endIdx !== -1) {
        const jsonStr = text.substring(startIdx, endIdx);
        try {
          const data = JSON.parse(jsonStr);
          const results = data.metaData?.mosaicProviderJobCardsModel?.results;
          if (Array.isArray(results)) return results;
        } catch {}
      }
    }
  }

  marker = 'window._initialData';
  idx = text.indexOf(marker);
  if (idx !== -1) {
    const eqIdx = text.indexOf('=', idx);
    const startIdx = text.indexOf('{', eqIdx);
    if (startIdx !== -1) {
      let braceCount = 0;
      let endIdx = -1;
      for (let i = startIdx; i < text.length; i++) {
        if (text[i] === '{') braceCount++;
        else if (text[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            endIdx = i + 1;
            break;
          }
        }
      }
      if (endIdx !== -1) {
        const jsonStr = text.substring(startIdx, endIdx);
        try {
          const resultsMatch = jsonStr.match(/"results"\s*:\s*(\[\s*\{[\s\S]*?\}\s*\])\s*,\s*"searchLocation"/);
          if (resultsMatch) {
             const parsed = JSON.parse(resultsMatch[1]);
             if (Array.isArray(parsed)) return parsed;
          }
        } catch {}
      }
    }
  }
  
  const ldJsonPattern = /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let match;
  const jobs = [];
  while ((match = ldJsonPattern.exec(text))) {
    try {
      const parsed = JSON.parse(match[1]);
      const items = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);
      for (const item of items) {
         if (item['@type'] === 'JobPosting') {
            jobs.push({
               title: item.title,
               company: item.hiringOrganization?.name,
               location: item.jobLocation?.address?.addressLocality || '',
               snippet: item.description,
               jobkey: item.url?.match(/[?&]jk=([a-zA-Z0-9]+)/)?.[1],
               link: item.url,
               pubDate: item.datePosted
            });
         }
      }
    } catch {}
  }
  if (jobs.length > 0) return jobs;

  const resultsMatch = text.match(/"results"\s*:\s*(\[\s*\{[\s\S]*?\}\s*\])\s*,\s*"searchLocation"/);
  if (resultsMatch) {
    try {
      const parsed = JSON.parse(resultsMatch[1]);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return [];
    }
  }
  return [];
}

export function normalizeIndeedJob(rawJob = {}, baseUrl = 'https://www.indeed.com') {
  const jobKey = compactText(rawJob.jobkey || rawJob.id);
  const title = compactText(rawJob.normTitle || rawJob.title || rawJob.position);
  const company = compactText(rawJob.truncatedCompany || rawJob.company || rawJob.companyName);
  const location = compactText(rawJob.formattedLocation || rawJob.location || (rawJob.remoteLocation ? 'Remote' : ''));
  const isRemote = Boolean(
    rawJob.remoteLocation ||
    /remote|work from home|wfh|telecommute|anywhere/i.test(`${location} ${title}`)
  );
  const salary = compactText(rawJob.salarySnippet?.text || rawJob.salary || '');
  const description = stripHtml(rawJob.snippet || rawJob.description || '');

  let applicationUrl = '';
  if (rawJob.link) {
    applicationUrl = rawJob.link.startsWith('http') ? rawJob.link : new URL(rawJob.link, baseUrl).toString();
  } else if (rawJob.viewJobLink) {
    applicationUrl = rawJob.viewJobLink.startsWith('http') ? rawJob.viewJobLink : new URL(rawJob.viewJobLink, baseUrl).toString();
  } else if (jobKey) {
    applicationUrl = `${baseUrl.replace(/\/$/, '')}/viewjob?jk=${jobKey}`;
  }

  const postedAt = rawJob.pubDate
    ? (typeof rawJob.pubDate === 'number' ? new Date(rawJob.pubDate).toISOString() : String(rawJob.pubDate))
    : '';

  return {
    source: 'indeed',
    source_site: 'indeed',
    sourceJobId: jobKey,
    title,
    company,
    location: location || (isRemote ? 'Remote' : 'Nigeria'),
    jobType: compactText(rawJob.jobTypes?.[0] || ''),
    salary,
    description,
    postedDate: postedAt,
    postedAt,
    is_remote: isRemote,
    job_url: applicationUrl,
    applicationUrl,
    hasIndeedApply: Boolean(rawJob.indeedApplyEnabled),
    externalApplyUrl: rawJob.companyApplyUrl || rawJob.externalApplyUrl || rawJob.thirdPartyApplyUrl || '',
    thirdPartyApplyUrl: rawJob.companyApplyUrl || rawJob.externalApplyUrl || rawJob.thirdPartyApplyUrl || '',
    raw: rawJob
  };
}

export function resolveIndeedSearchUrls(config = {}, siteConfig = {}) {
  const custom = normalizeList(siteConfig.urls || siteConfig.searchUrls);
  if (custom.length) return custom;

  const isSister = config.profileName === 'sister' || /sister/i.test(config.candidate?.name || '');

  if (isSister) {
    return [
      'https://www.indeed.com/jobs?q=customer+support&l=Remote&sort=date',
      'https://www.indeed.com/jobs?q=virtual+assistant&l=Remote&sort=date',
      'https://www.indeed.com/jobs?q=appointment+setter&l=Remote&sort=date',
      'https://www.indeed.com/jobs?q=crm+specialist&l=Remote&sort=date',
      'https://www.indeed.com/jobs?q=customer+service+representative&l=Remote&sort=date',
      'https://www.indeed.com/jobs?q=data+entry&l=Remote&sort=date',
      'https://ng.indeed.com/jobs?q=customer+service&l=Abuja&sort=date',
      'https://ng.indeed.com/jobs?q=administrative+assistant&l=Abuja&sort=date',
      'https://ng.indeed.com/jobs?q=virtual+assistant&l=Abuja&sort=date',
      'https://ng.indeed.com/jobs?q=receptionist&l=Abuja&sort=date',
      'https://ng.indeed.com/jobs?q=office+assistant&l=Abuja&sort=date',
      'https://ng.indeed.com/jobs?q=customer+service&sort=date',
      'https://ng.indeed.com/jobs?q=virtual+assistant&sort=date',
      'https://ng.indeed.com/jobs?q=administrative+assistant&sort=date'
    ];
  }

  return [
    'https://www.indeed.com/jobs?q=full+stack+developer&l=Remote&sort=date',
    'https://www.indeed.com/jobs?q=software+engineer&l=Remote&sort=date',
    'https://www.indeed.com/jobs?q=frontend+developer&l=Remote&sort=date',
    'https://www.indeed.com/jobs?q=backend+developer&l=Remote&sort=date',
    'https://www.indeed.com/jobs?q=react+developer&l=Remote&sort=date',
    'https://www.indeed.com/jobs?q=laravel+developer&l=Remote&sort=date',
    'https://www.indeed.com/jobs?q=web+developer&l=Remote&sort=date',
    'https://www.indeed.com/jobs?q=shopify+developer&l=Remote&sort=date',
    'https://www.indeed.com/jobs?q=php+developer&l=Remote&sort=date',
    'https://www.indeed.com/jobs?q=ecommerce+developer&l=Remote&sort=date',
    'https://www.indeed.com/jobs?q=wordpress+developer&l=Remote&sort=date',
    'https://www.indeed.com/jobs?q=technical+seo&l=Remote&sort=date',
    'https://www.indeed.com/jobs?q=seo+specialist&l=Remote&sort=date',
    'https://ng.indeed.com/jobs?q=software+engineer+remote&sort=date',
    'https://ng.indeed.com/jobs?q=full+stack+developer+remote&sort=date',
    'https://ng.indeed.com/jobs?q=frontend+developer+remote&sort=date',
    'https://ng.indeed.com/jobs?q=backend+developer+remote&sort=date',
    'https://ng.indeed.com/jobs?q=react+developer+remote&sort=date',
    'https://ng.indeed.com/jobs?q=wordpress+developer+remote&sort=date',
    'https://ng.indeed.com/jobs?q=shopify+developer+remote&sort=date',
    'https://ng.indeed.com/jobs?q=ecommerce+developer+remote&sort=date',
    'https://ng.indeed.com/jobs?q=laravel+developer+remote&sort=date',
    'https://ng.indeed.com/jobs?q=php+developer+remote&sort=date',
    'https://ng.indeed.com/jobs?q=seo+specialist+remote&sort=date',
    'https://ng.indeed.com/jobs?q=web+developer+remote&sort=date',
    'https://ng.indeed.com/jobs?q=software+engineer&sort=date',
    'https://ng.indeed.com/jobs?q=full+stack+developer&sort=date',
    'https://ng.indeed.com/jobs?q=frontend+developer&sort=date',
    'https://ng.indeed.com/jobs?q=react+developer&sort=date',
    'https://ng.indeed.com/jobs?q=shopify+developer&sort=date',
    'https://ng.indeed.com/jobs?q=web+developer&sort=date',
    'https://ng.indeed.com/jobs?q=ecommerce+developer&sort=date'
  ];
}

export function rotateSearchUrls(urls = [], intervalMinutes = 15) {
  if (!Array.isArray(urls) || urls.length <= 1) return urls || [];
  const offset = Math.floor(Date.now() / (1000 * 60 * intervalMinutes)) % urls.length;
  return [...urls.slice(offset), ...urls.slice(0, offset)];
}

export function parseIndeedMarkdown(markdown, baseUrl = 'https://www.indeed.com') {
  if (!markdown) return [];
  const jobs = [];
  const blocks = String(markdown).split(/\n(?=\[[^\]]+\]\(\/(?:rc\/clk|viewjob|pagead\/clk)\?jk=)/);
  for (const block of blocks) {
    const titleMatch = block.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (!titleMatch) continue;
    const title = compactText(titleMatch[1]);
    const rawLink = titleMatch[2].replace(/\\&/g, '&').trim();
    const jkMatch = rawLink.match(/[?&]jk=([a-zA-Z0-9]+)/);
    if (!jkMatch) continue;
    const jobKey = jkMatch[1];
    const applicationUrl = rawLink.startsWith('http') ? rawLink : new URL(rawLink, baseUrl).toString();

    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const remainingLines = lines.slice(1).filter((l) =>
      !l.startsWith('View all') &&
      !l.startsWith('Salary Search:') &&
      !l.startsWith('See popular') &&
      !l.startsWith('[Skip')
    );

    let isEasyApply = false;
    let company = '';
    let location = '';
    let salary = '';
    let jobType = '';
    let lineIdx = 0;

    if (remainingLines[lineIdx]?.toLowerCase() === 'easily apply') {
      isEasyApply = true;
      lineIdx++;
    }
    if (remainingLines[lineIdx]) {
      company = compactText(remainingLines[lineIdx]);
      lineIdx++;
    }
    if (remainingLines[lineIdx]) {
      location = compactText(remainingLines[lineIdx]);
      lineIdx++;
    }
    if (remainingLines[lineIdx] && (remainingLines[lineIdx].includes('$') || remainingLines[lineIdx].includes('₦') || remainingLines[lineIdx].includes('£') || remainingLines[lineIdx].includes('€') || /a year|a month|an hour/i.test(remainingLines[lineIdx]))) {
      salary = compactText(remainingLines[lineIdx]);
      lineIdx++;
    }
    if (remainingLines[lineIdx] && /full-time|part-time|contract|temporary|internship/i.test(remainingLines[lineIdx])) {
      jobType = compactText(remainingLines[lineIdx]);
      lineIdx++;
    }
    const description = stripHtml(remainingLines.slice(lineIdx).join('\n'));
    const isRemote = Boolean(
      /remote|work from home|wfh|telecommute|anywhere/i.test(`${location} ${title}`)
    );

    jobs.push({
      source: 'indeed',
      source_site: 'indeed',
      sourceJobId: jobKey,
      title,
      company,
      location: location || (isRemote ? 'Remote' : 'Nigeria'),
      jobType,
      salary,
      description,
      postedAt: new Date().toISOString(),
      is_remote: isRemote,
      applicationUrl,
      hasIndeedApply: isEasyApply,
      thirdPartyApplyUrl: '',
      raw: {
        title,
        company,
        location,
        salary,
        jobkey: jobKey,
        link: applicationUrl
      }
    });
  }
  return jobs;
}

export async function fetchIndeedViaBrightData(url, token, options = {}) {
  const timeoutMs = options.timeoutMs || 60000;
  let sess = options.sessionId;
  if (!sess) {
    const initResp = await fetch(`https://mcp.brightdata.com/mcp?token=${token}`, {
      method: 'POST',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'jobpilot', version: '1.0.0' } }
      })
    });
    if (!initResp.ok) {
      throw new Error(`Bright Data MCP init failed: HTTP ${initResp.status}`);
    }
    sess = initResp.headers.get('mcp-session-id');
    if (!sess) {
      throw new Error('Bright Data MCP did not return a session ID.');
    }
  }

  const callResp = await fetch(`https://mcp.brightdata.com/mcp?token=${token}`, {
    method: 'POST',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-session-id': sess },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'scrape_as_markdown',
        arguments: { url }
      }
    })
  });
  if (!callResp.ok) {
    throw new Error(`Bright Data MCP call failed: HTTP ${callResp.status}`);
  }
  const text = await callResp.text();
  const match = text.match(/data:\s*(\{.*\})/);
  if (!match) return { markdown: '', sessionId: sess };
  const parsed = JSON.parse(match[1]);
  return {
    markdown: parsed.result?.content?.[0]?.text || '',
    sessionId: sess
  };
}

export class IndeedScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('indeed', config, siteConfig);
  }

  async fetchJobs() {
    if (this.config.mockPlaywright || this.siteConfig.mockJobs) {
      return this.siteConfig.mockJobs || [];
    }

    const allSearchUrls = resolveIndeedSearchUrls(this.config, this.siteConfig);
    const searchUrls = rotateSearchUrls(allSearchUrls, 10);
    const rawJobs = [];
    const limit = this.resolveMaxJobsPerRun();
    const perUrlLimit = limit > 0 ? Math.max(5, Math.min(10, Math.ceil(limit / 2))) : 15;

    const mcpToken = this.config.brightDataMcpToken ||
      process.env.BRIGHT_DATA_MCP_TOKEN ||
      process.env.BRIGHT_DATA_API_KEY ||
      'a37e8852-05ae-474d-9b34-0099f2f9aa81';

    if (mcpToken && !this.config.disableBrightData) {
      try {
        await this.log('Using Bright Data MCP unblocker for Indeed searches...');
        let activeSessionId = null;
        for (const url of searchUrls) {
          if (limit > 0 && rawJobs.length >= limit) break;
          try {
            await this.log(`Fetching Indeed listings via Bright Data MCP: ${url}`);
            const result = await fetchWithBackoff(() => fetchIndeedViaBrightData(url, mcpToken, { sessionId: activeSessionId }));
            activeSessionId = result.sessionId || activeSessionId;
            const baseUrl = url.startsWith('https://ng.') ? 'https://ng.indeed.com' : 'https://www.indeed.com';
            const parsedJobs = parseIndeedMarkdown(result.markdown, baseUrl);
            const jobsToAdd = (limit > 0 && parsedJobs.length > perUrlLimit)
              ? parsedJobs.slice(0, perUrlLimit)
              : parsedJobs;
            for (const job of jobsToAdd) {
              rawJobs.push(job);
            }
            await this.log(`Indeed (Bright Data MCP) returned ${parsedJobs.length} jobs (${jobsToAdd.length} sampled) for ${url}`);
          } catch (err) {
            await this.log(`Bright Data MCP failed on ${url}: ${err.message}`);
            activeSessionId = null;
          }
        }
        if (rawJobs.length > 0) {
          return rawJobs;
        }
        await this.log('Bright Data MCP returned 0 jobs; attempting Playwright fallback...');
      } catch (err) {
        await this.log(`Bright Data MCP scraper failed: ${err.message}; falling back to Playwright...`);
      }
    }

    let browser;
    try {
      const proxyConfig = await getPlaywrightProxy(this.config);
      browser = await chromium.launch({
        headless: this.config.headless !== false,
        args: stealthArgs.filter((arg) => arg !== '--no-startup-window' && arg !== '--silent'),
        ...proxyConfig
      });

      const context = await browser.newContext({
        userAgent: MODERN_UAS[Math.floor(Math.random() * MODERN_UAS.length)],
        viewport: { width: 1366, height: 768 },
        locale: 'en-US'
      });
      await context.addInitScript(getStealthScript());

      const cookies = await loadIndeedCookies(this.config.profileName, this.config);
      if (cookies?.length) {
        await context.addCookies(cookies).catch(() => {});
        await this.log(`Loaded ${cookies.length} authenticated session cookies for Indeed.`);
      }

      const page = await context.newPage();

      for (const url of searchUrls) {
        if (limit > 0 && rawJobs.length >= limit) break;
        try {
          await this.log(`Fetching Indeed listings: ${url}`);
          await fetchWithBackoff(async () => {
            const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
            if (resp && (resp.status() === 403 || resp.status() === 429)) {
               throw new Error(`Blocked by Indeed with status ${resp.status()}`);
            }
          });
          await page.waitForTimeout(2500);

          const scriptText = await page.evaluate(() => {
            const el = document.getElementById('mosaic-data');
            return el ? el.textContent : '';
          });

          let pageResults = parseMosaicJobCards(scriptText);

          // DOM fallback if mosaic-data wasn't found
          if (!pageResults.length) {
            pageResults = await page.evaluate(() => {
              const cards = Array.from(document.querySelectorAll('.job_seen_beacon, [data-jk]'));
              return cards.map((c) => {
                const titleLink = c.querySelector('h2.jobTitle a, a[data-jk], [data-testid="job-title-link"]');
                const comp = c.querySelector('[data-testid="company-name"], .companyName');
                const loc = c.querySelector('[data-testid="text-location"], .companyLocation');
                const snip = c.querySelector('[data-testid="job-snippet"], .job-snippet');
                const jk = c.getAttribute('data-jk') || titleLink?.getAttribute('data-jk');
                return {
                  jobkey: jk,
                  title: titleLink?.innerText?.trim() || '',
                  company: comp?.innerText?.trim() || '',
                  formattedLocation: loc?.innerText?.trim() || '',
                  snippet: snip?.innerText?.trim() || '',
                  link: titleLink?.getAttribute('href') || ''
                };
              }).filter((j) => j.title && j.jobkey);
            });
          }

          const baseUrl = url.startsWith('https://ng.') ? 'https://ng.indeed.com' : 'https://www.indeed.com';
          const itemsToAdd = (limit > 0 && pageResults.length > perUrlLimit)
            ? pageResults.slice(0, perUrlLimit)
            : pageResults;
          for (const item of itemsToAdd) {
            rawJobs.push(normalizeIndeedJob(item, baseUrl));
          }
          await this.log(`Indeed search returned ${pageResults.length} jobs (${itemsToAdd.length} sampled) for ${url}`);
        } catch (err) {
          await this.log(`Failed Indeed search on ${url}: ${err.message}`);
        }
      }
    } catch (err) {
      await this.log(`Indeed scraper browser session failed: ${err.message}`);
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }

    return rawJobs;
  }

  matchesSitePolicy(job) {
    if (!super.matchesSitePolicy(job)) return false;

    const isSister = this.config.profileName === 'sister' || /sister/i.test(this.config.candidate?.name || '');
    const isTolu = this.config.profileName === 'tolu' || /tolu/i.test(this.config.candidate?.name || '');

    const title = (job.title || '').toLowerCase();

    if (isSister) {
      if (/\b(software engineer|web developer|frontend developer|backend developer|full stack|devops|php developer|laravel|react developer|python developer|golang|c\+\+|java developer|firmware|embedded)\b/i.test(title)) {
        return false;
      }
    } else if (isTolu) {
      if (/\b(customer support|customer service|virtual assistant|sales representative|call center|telemarketing|help desk|data entry clerk|receptionist|office assistant)\b/i.test(title)) {
        return false;
      }
    }

    if (this.siteConfig.remoteOnly === true && !job.is_remote && !/nigeria|lagos|abuja/i.test(job.location)) {
      return false;
    }

    return true;
  }
}

export async function scrapeIndeedJobs(config, siteConfig = {}) {
  return new IndeedScraper(config, siteConfig).scrape();
}

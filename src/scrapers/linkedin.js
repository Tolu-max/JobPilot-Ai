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
      if (err.message.includes('403') || err.message.includes('429') || err.message.includes('blocked') || err.message.includes('failed') || err.message.includes('CAPTCHA')) {
        if (i === maxRetries - 1) throw err;
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000 + Math.random() * 500));
      } else {
        throw err;
      }
    }
  }
}


export async function loadLinkedinCookies(profileName = '', config = {}) {
  const possiblePaths = [
    config.linkedinCookiesPath,
    profileName ? path.join('profiles', profileName, 'linkedin_cookies.json') : null,
    path.join('profiles', 'tolu', 'linkedin_cookies.json'),
    path.join('data', 'linkedin_cookies.json'),
    profileName ? path.join('data', 'profiles', profileName, 'linkedin_cookies.json') : null,
    path.join('data', 'profiles', 'tolu', 'linkedin_cookies.json')
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

export function normalizeLinkedinJob(rawJob = {}, baseUrl = 'https://www.linkedin.com') {
  const jobKey = compactText(rawJob.jobkey || rawJob.id || rawJob.jobId);
  const title = compactText(rawJob.normTitle || rawJob.title || rawJob.position);
  const company = compactText(rawJob.company || rawJob.companyName || rawJob.truncatedCompany);
  const rawLocation = compactText(rawJob.formattedLocation || rawJob.location || (rawJob.remoteLocation ? 'Remote' : ''));
  const isRemote = Boolean(
    rawJob.remoteLocation ||
    /remote|work from home|wfh|telecommute|anywhere|distributed/i.test(`${rawLocation} ${title}`)
  );
  const location = rawLocation || (isRemote ? 'Remote' : 'Nigeria');
  const salary = compactText(rawJob.salarySnippet?.text || rawJob.salary || '');
  const description = stripHtml(rawJob.snippet || rawJob.description || '');

  let applicationUrl = '';
  if (rawJob.link) {
    applicationUrl = rawJob.link.startsWith('http') ? rawJob.link : new URL(rawJob.link, baseUrl).toString();
  } else if (rawJob.viewJobLink) {
    applicationUrl = rawJob.viewJobLink.startsWith('http') ? rawJob.viewJobLink : new URL(rawJob.viewJobLink, baseUrl).toString();
  } else if (jobKey) {
    applicationUrl = `https://www.linkedin.com/jobs/view/${jobKey}`;
  }

  const postedAt = rawJob.pubDate
    ? (typeof rawJob.pubDate === 'number' ? new Date(rawJob.pubDate).toISOString() : String(rawJob.pubDate))
    : '';

  return {
    source: 'linkedin',
    source_site: 'linkedin',
    sourceJobId: jobKey,
    title,
    company,
    location,
    jobType: compactText(rawJob.jobTypes?.[0] || rawJob.jobType || ''),
    salary,
    description,
    postedAt,
    is_remote: isRemote,
    applicationUrl,
    hasEasyApply: Boolean(rawJob.hasEasyApply || rawJob.easyApply),
    externalApplyUrl: rawJob.externalApplyUrl || rawJob.thirdPartyApplyUrl || '',
    raw: rawJob
  };
}

export function resolveLinkedinSearchUrls(config = {}, siteConfig = {}) {
  const custom = normalizeList(siteConfig.urls || siteConfig.searchUrls);
  if (custom.length) return custom;

  const isSister = config.profileName === 'sister' || /sister/i.test(config.candidate?.name || '');

  if (isSister) {
    return [
      'https://www.linkedin.com/jobs/search?keywords=customer+support&location=Remote&sortBy=DD',
      'https://www.linkedin.com/jobs/search?keywords=virtual+assistant&location=Remote&sortBy=DD',
      'https://www.linkedin.com/jobs/search?keywords=appointment+setter&location=Remote&sortBy=DD',
      'https://www.linkedin.com/jobs/search?keywords=crm+specialist&location=Remote&sortBy=DD',
      'https://www.linkedin.com/jobs/search?keywords=customer+service+representative&location=Remote&sortBy=DD',
      'https://www.linkedin.com/jobs/search?keywords=data+entry&location=Remote&sortBy=DD',
      'https://www.linkedin.com/jobs/search?keywords=customer+service&location=Abuja%2C%20Nigeria&sortBy=DD',
      'https://www.linkedin.com/jobs/search?keywords=administrative+assistant&location=Abuja%2C%20Nigeria&sortBy=DD',
      'https://www.linkedin.com/jobs/search?keywords=virtual+assistant&location=Abuja%2C%20Nigeria&sortBy=DD',
      'https://www.linkedin.com/jobs/search?keywords=receptionist&location=Abuja%2C%20Nigeria&sortBy=DD',
      'https://www.linkedin.com/jobs/search?keywords=customer+service&location=Nigeria&sortBy=DD',
      'https://www.linkedin.com/jobs/search?keywords=virtual+assistant&location=Nigeria&sortBy=DD'
    ];
  }

  return [
    'https://www.linkedin.com/jobs/search?keywords=Full+Stack+Developer&location=Remote&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=Software+Engineer&location=Remote&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=Frontend+Developer&location=Remote&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=Backend+Developer&location=Remote&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=React+Developer&location=Remote&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=WordPress+Developer&location=Remote&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=Shopify+Developer&location=Remote&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=Ecommerce+Developer&location=Remote&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=Laravel+Developer&location=Remote&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=PHP+Developer&location=Remote&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=SEO+Specialist&location=Remote&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=Web+Developer&location=Remote&sortBy=DD',

    'https://www.linkedin.com/jobs/search?keywords=software+engineer+Abuja&f_WT=1&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=full+stack+developer+Lagos&f_WT=1&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=frontend+developer+Lagos&f_WT=1&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=backend+developer+Lagos&f_WT=1&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=react+developer+Lagos&f_WT=1&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=php+developer+Lagos&f_WT=1&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=software+developer+Abuja&f_WT=1&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=web+developer+Abuja&f_WT=1&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=IT+Abuja&f_WT=1&sortBy=DD',
    'https://www.linkedin.com/jobs/search?keywords=remote+developer+Nigeria&sortBy=DD'
  ];
}

export function rotateSearchUrls(urls = [], intervalMinutes = 15) {
  if (!Array.isArray(urls) || urls.length <= 1) return urls || [];
  const offset = Math.floor(Date.now() / (1000 * 60 * intervalMinutes)) % urls.length;
  return [...urls.slice(offset), ...urls.slice(0, offset)];
}

export function parseLinkedinMarkdown(markdown, baseUrl = 'https://www.linkedin.com') {
  if (!markdown) return [];
  const jobs = [];
  const blocks = String(markdown).split(/\n(?=\s*\[[^\]]+\]\(https?:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/jobs\/view\/)/);

  for (const block of blocks) {
    const titleMatch = block.match(/\[([^\]]+)\]\((https?:\/\/(?:[a-z0-9-]+\.)?linkedin\.com\/jobs\/view\/[^)]+)\)/);
    if (!titleMatch) continue;
    const title = compactText(titleMatch[1]);
    const rawLink = titleMatch[2].replace(/\\&/g, '&').trim();

    // Match numeric job ID: ...-4472449774?... or /view/4472449774
    const idMatch = rawLink.match(/(?:-|\/jobs\/view\/)(\d{8,14})/);
    if (!idMatch) continue;
    const jobKey = idMatch[1];
    const applicationUrl = `https://www.linkedin.com/jobs/view/${jobKey}`;

    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    let company = '';
    let location = '';

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!company) {
        const compMatch = line.match(/\[([^\]]+)\]\(https:\/\/[a-z]{0,3}\.?linkedin\.com\/company\/[^)]+\)/);
        if (compMatch) {
          company = compactText(compMatch[1]);
          continue;
        }
      }
      if (company && !location && line && !line.startsWith('[') && !line.startsWith('http')) {
        // Location line usually: "United States 1 week ago" or "Abuja, Federal Capital Territory, Nigeria 2 months ago"
        const cleanLoc = line.replace(/\b\d+\s+(?:hour|day|week|month|year)s?\s+ago\b/i, '').trim();
        if (cleanLoc) {
          location = compactText(cleanLoc);
        }
      }
    }

    const isRemote = /remote|work from home|wfh|anywhere|distributed/i.test(`${location} ${title}`);
    const hasEasyApply = /easy apply|apply with linkedin/i.test(block);

    jobs.push({
      source: 'linkedin',
      source_site: 'linkedin',
      sourceJobId: jobKey,
      title,
      company: company || 'LinkedIn Employer',
      location: location || (isRemote ? 'Remote' : 'Nigeria'),
      is_remote: isRemote,
      applicationUrl,
      hasEasyApply,
      description: compactText(lines.slice(1).join(' ')),
      raw: {
        title,
        company,
        location,
        jobkey: jobKey,
        link: applicationUrl,
        rawLink
      }
    });
  }

  return jobs;
}

export async function fetchLinkedinViaBrightData(url, token, options = {}) {
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

export class LinkedinScraper extends BaseScraper {
  constructor(config, siteConfig = {}) {
    super('linkedin', config, siteConfig);
  }

  async fetchJobs() {
    if (this.config.mockPlaywright || this.siteConfig.mockJobs) {
      return this.siteConfig.mockJobs || [];
    }

    const allSearchUrls = resolveLinkedinSearchUrls(this.config, this.siteConfig);
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
        await this.log('Using Bright Data MCP unblocker for LinkedIn searches...');
        let activeSessionId = null;
        for (const url of searchUrls) {
          if (limit > 0 && rawJobs.length >= limit) break;
          try {
            await this.log(`Fetching LinkedIn listings via Bright Data MCP: ${url}`);
            const result = await fetchWithBackoff(() => fetchLinkedinViaBrightData(url, mcpToken, { sessionId: activeSessionId }));
            activeSessionId = result.sessionId || activeSessionId;
            const parsedJobs = parseLinkedinMarkdown(result.markdown);
            const jobsToAdd = (limit > 0 && parsedJobs.length > perUrlLimit)
              ? parsedJobs.slice(0, perUrlLimit)
              : parsedJobs;
            for (const job of jobsToAdd) {
              rawJobs.push(job);
            }
            await this.log(`LinkedIn (Bright Data MCP) returned ${parsedJobs.length} jobs (${jobsToAdd.length} sampled) for ${url}`);
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

      const cookies = await loadLinkedinCookies(this.config.profileName, this.config);
      if (cookies?.length) {
        await context.addCookies(cookies).catch(() => {});
        await this.log(`Loaded ${cookies.length} authenticated session cookies for LinkedIn.`);
      }

      const page = await context.newPage();

      for (const url of searchUrls) {
        if (limit > 0 && rawJobs.length >= limit) break;
        try {
          await this.log(`Fetching LinkedIn listings: ${url}`);
          await fetchWithBackoff(async () => {
            const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
            if (resp) {
               const status = resp.status();
               if (status === 403 || status === 429) throw new Error(`Blocked by LinkedIn with status ${status}`);
               if (status === 999) throw new Error('LinkedIn Session Expired or Hard Block');
            }
            const pageText = await page.content();
            if (pageText.includes('authwall') || pageText.includes('login')) {
               throw new Error('LinkedIn Session expired');
            }
            if (pageText.includes('security check') || pageText.includes('captcha') || pageText.includes('verify you are human')) {
               throw new Error('CAPTCHA detected');
            }
          });
          await page.waitForTimeout(2500);

          const pageResults = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('.base-card, .job-search-card, [data-entity-urn*="jobPosting"]'));
            return cards.map((c) => {
              const titleLink = c.querySelector('.base-search-card__title, h3, a[href*="/jobs/view/"]');
              const comp = c.querySelector('.base-search-card__subtitle, h4, [data-tracking-control-name*="company_name"]');
              const loc = c.querySelector('.job-search-card__location');
              const urn = c.getAttribute('data-entity-urn') || '';
              const idMatch = urn.match(/jobPosting:(\d+)/) || (titleLink?.getAttribute('href') || '').match(/(\d{8,14})/);
              const jk = idMatch ? idMatch[1] : '';
              const link = titleLink?.getAttribute('href') || (jk ? `https://www.linkedin.com/jobs/view/${jk}` : '');

              return {
                jobkey: jk,
                title: titleLink?.innerText?.trim() || '',
                company: comp?.innerText?.trim() || '',
                formattedLocation: loc?.innerText?.trim() || '',
                link
              };
            }).filter((j) => j.title && j.jobkey);
          });

          const itemsToAdd = (limit > 0 && pageResults.length > perUrlLimit)
            ? pageResults.slice(0, perUrlLimit)
            : pageResults;
          for (const item of itemsToAdd) {
            rawJobs.push(normalizeLinkedinJob(item));
          }
          await this.log(`LinkedIn search returned ${pageResults.length} jobs (${itemsToAdd.length} sampled) for ${url}`);
        } catch (err) {
          await this.log(`Failed LinkedIn search on ${url}: ${err.message}`);
        }
      }
    } catch (err) {
      await this.log(`LinkedIn scraper browser session failed: ${err.message}`);
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

export async function scrapeLinkedinJobs(config, siteConfig = {}) {
  return new LinkedinScraper(config, siteConfig).scrape();
}

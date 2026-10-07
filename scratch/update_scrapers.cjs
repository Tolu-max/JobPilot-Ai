const fs = require('fs');
let code = fs.readFileSync('src/scrapers/indeed.js', 'utf8');

// 1. Update resolveIndeedSearchUrls
code = code.replace(/return \[\s*'https:\/\/www\.indeed\.com\/jobs\?q=full\+stack\+developer&l=Remote&sort=date',[\s\S]*?\];/, "return [\n" +
"    'https://www.indeed.com/jobs?q=full+stack+developer&l=Remote&sort=date',\n" +
"    'https://www.indeed.com/jobs?q=software+engineer&l=Remote&sort=date',\n" +
"    'https://www.indeed.com/jobs?q=frontend+developer&l=Remote&sort=date',\n" +
"    'https://www.indeed.com/jobs?q=backend+developer&l=Remote&sort=date',\n" +
"    'https://www.indeed.com/jobs?q=react+developer&l=Remote&sort=date',\n" +
"    'https://www.indeed.com/jobs?q=laravel+developer&l=Remote&sort=date',\n" +
"    'https://www.indeed.com/jobs?q=web+developer&l=Remote&sort=date',\n" +
"    'https://www.indeed.com/jobs?q=shopify+developer&l=Remote&sort=date',\n" +
"    'https://www.indeed.com/jobs?q=php+developer&l=Remote&sort=date',\n" +
"    'https://www.indeed.com/jobs?q=ecommerce+developer&l=Remote&sort=date',\n" +
"    'https://www.indeed.com/jobs?q=wordpress+developer&l=Remote&sort=date',\n" +
"    'https://www.indeed.com/jobs?q=technical+seo&l=Remote&sort=date',\n" +
"    'https://www.indeed.com/jobs?q=seo+specialist&l=Remote&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=software+engineer+remote&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=full+stack+developer+remote&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=frontend+developer+remote&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=backend+developer+remote&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=react+developer+remote&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=wordpress+developer+remote&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=shopify+developer+remote&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=ecommerce+developer+remote&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=laravel+developer+remote&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=php+developer+remote&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=seo+specialist+remote&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=web+developer+remote&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=software+engineer&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=full+stack+developer&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=frontend+developer&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=react+developer&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=shopify+developer&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=web+developer&sort=date',\n" +
"    'https://ng.indeed.com/jobs?q=ecommerce+developer&sort=date'\n" +
"  ];");

// 2. Update normalizeIndeedJob
code = code.replace(/return \{\s*source: 'indeed',[\s\S]*?raw: rawJob\s*\};/, "return {\n" +
"    source: 'indeed',\n" +
"    source_site: 'indeed',\n" +
"    sourceJobId: jobKey,\n" +
"    title,\n" +
"    company,\n" +
"    location: location || (isRemote ? 'Remote' : 'Nigeria'),\n" +
"    jobType: compactText(rawJob.jobTypes?.[0] || ''),\n" +
"    salary,\n" +
"    description,\n" +
"    postedDate: postedAt,\n" +
"    postedAt,\n" +
"    is_remote: isRemote,\n" +
"    job_url: applicationUrl,\n" +
"    applicationUrl,\n" +
"    hasIndeedApply: Boolean(rawJob.indeedApplyEnabled),\n" +
"    externalApplyUrl: rawJob.companyApplyUrl || rawJob.externalApplyUrl || rawJob.thirdPartyApplyUrl || '',\n" +
"    thirdPartyApplyUrl: rawJob.companyApplyUrl || rawJob.externalApplyUrl || rawJob.thirdPartyApplyUrl || '',\n" +
"    raw: rawJob\n  };");

// 3. Add UAs
code = code.replace(/import \{ getPlaywrightProxy \} from '\.\.\/proxyRotator\.js';/, "import { getPlaywrightProxy } from '../proxyRotator.js';\n\n" +
"const MODERN_UAS = [\n" +
"  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',\n" +
"  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',\n" +
"  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',\n" +
"  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',\n" +
"  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0 Safari/537.36'\n" +
"];\n\n" +
"async function fetchWithBackoff(fetchFn, maxRetries = 3) {\n" +
"  for (let i = 0; i < maxRetries; i++) {\n" +
"    try {\n" +
"      return await fetchFn();\n" +
"    } catch (err) {\n" +
"      if (err.message.includes('403') || err.message.includes('429') || err.message.includes('blocked') || err.message.includes('failed')) {\n" +
"        if (i === maxRetries - 1) throw err;\n" +
"        await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000 + Math.random() * 500));\n" +
"      } else {\n" +
"        throw err;\n" +
"      }\n" +
"    }\n" +
"  }\n" +
"}\n");

// 4. Update parseMosaicJobCards
code = code.replace(/export function parseMosaicJobCards\(htmlOrScript\) \{[\s\S]*?return \[\];\n\}/, "export function parseMosaicJobCards(htmlOrScript) {\n" +
"  if (!htmlOrScript) return [];\n" +
"  const text = String(htmlOrScript);\n  \n" +
"  let marker = 'mosaic-provider-jobcards';\n" +
"  let idx = text.indexOf(marker);\n" +
"  if (idx !== -1) {\n" +
"    const eqIdx = text.indexOf('=', idx);\n" +
"    const startIdx = text.indexOf('{', eqIdx);\n" +
"    if (startIdx !== -1) {\n" +
"      let braceCount = 0;\n" +
"      let endIdx = -1;\n" +
"      for (let i = startIdx; i < text.length; i++) {\n" +
"        if (text[i] === '{') braceCount++;\n" +
"        else if (text[i] === '}') {\n" +
"          braceCount--;\n" +
"          if (braceCount === 0) {\n" +
"            endIdx = i + 1;\n" +
"            break;\n          }\n        }\n      }\n" +
"      if (endIdx !== -1) {\n" +
"        const jsonStr = text.substring(startIdx, endIdx);\n" +
"        try {\n" +
"          const data = JSON.parse(jsonStr);\n" +
"          const results = data.metaData?.mosaicProviderJobCardsModel?.results;\n" +
"          if (Array.isArray(results)) return results;\n        } catch {}\n      }\n    }\n  }\n\n" +
"  marker = 'window._initialData';\n" +
"  idx = text.indexOf(marker);\n" +
"  if (idx !== -1) {\n" +
"    const eqIdx = text.indexOf('=', idx);\n" +
"    const startIdx = text.indexOf('{', eqIdx);\n" +
"    if (startIdx !== -1) {\n" +
"      let braceCount = 0;\n" +
"      let endIdx = -1;\n" +
"      for (let i = startIdx; i < text.length; i++) {\n" +
"        if (text[i] === '{') braceCount++;\n" +
"        else if (text[i] === '}') {\n" +
"          braceCount--;\n" +
"          if (braceCount === 0) {\n" +
"            endIdx = i + 1;\n            break;\n          }\n        }\n      }\n" +
"      if (endIdx !== -1) {\n" +
"        const jsonStr = text.substring(startIdx, endIdx);\n" +
"        try {\n" +
"          const resultsMatch = jsonStr.match(/\"results\"\\s*:\\s*(\\[\\s*\\{[\\s\\S]*?\\}\\s*\\])\\s*,\\s*\"searchLocation\"/);\n" +
"          if (resultsMatch) {\n" +
"             const parsed = JSON.parse(resultsMatch[1]);\n" +
"             if (Array.isArray(parsed)) return parsed;\n          }\n        } catch {}\n      }\n    }\n  }\n  \n" +
"  const ldJsonPattern = /<script\\s+type=\"application\\/ld\\+json\">([\\s\\S]*?)<\\/script>/g;\n" +
"  let match;\n  const jobs = [];\n" +
"  while ((match = ldJsonPattern.exec(text))) {\n" +
"    try {\n" +
"      const parsed = JSON.parse(match[1]);\n" +
"      const items = Array.isArray(parsed) ? parsed : (parsed['@graph'] || [parsed]);\n" +
"      for (const item of items) {\n" +
"         if (item['@type'] === 'JobPosting') {\n" +
"            jobs.push({\n               title: item.title,\n               company: item.hiringOrganization?.name,\n               location: item.jobLocation?.address?.addressLocality || '',\n               snippet: item.description,\n               jobkey: item.url?.match(/[?&]jk=([a-zA-Z0-9]+)/)?.[1],\n               link: item.url,\n               pubDate: item.datePosted\n            });\n         }\n      }\n    } catch {}\n  }\n" +
"  if (jobs.length > 0) return jobs;\n\n" +
"  const resultsMatch = text.match(/\"results\"\\s*:\\s*(\\[\\s*\\{[\\s\\S]*?\\}\\s*\\])\\s*,\\s*\"searchLocation\"/);\n" +
"  if (resultsMatch) {\n    try {\n      const parsed = JSON.parse(resultsMatch[1]);\n      if (Array.isArray(parsed)) return parsed;\n    } catch {\n      return [];\n    }\n  }\n  return [];\n}");

// 5. Update Playwright instantiation to use UA pool
code = code.replace(/userAgent: stealthUserAgent,/, "userAgent: MODERN_UAS[Math.floor(Math.random() * MODERN_UAS.length)],");

// 6. Wrap Bright Data with fetchWithBackoff
code = code.replace(/const result = await fetchIndeedViaBrightData\(url, mcpToken, \{ sessionId: activeSessionId \}\);/, "const result = await fetchWithBackoff(() => fetchIndeedViaBrightData(url, mcpToken, { sessionId: activeSessionId }));");

// 7. Wrap Playwright go to with exponential backoff / retry logic
code = code.replace(/await page\.goto\(url, \{ waitUntil: 'domcontentloaded', timeout: 35000 \}\);/, "await fetchWithBackoff(async () => {\n            const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });\n            if (resp && (resp.status() === 403 || resp.status() === 429)) {\n               throw new Error(`Blocked by Indeed with status ${resp.status()}`);\n            }\n          });");

fs.writeFileSync('src/scrapers/indeed.js', code);

// NOW FOR LINKEDIN
let liCode = fs.readFileSync('src/scrapers/linkedin.js', 'utf8');

// 1. Update resolveLinkedinSearchUrls
liCode = liCode.replace(/return \[\s*'https:\/\/www\.linkedin\.com\/jobs\/search\?keywords=full\+stack\+developer&location=Remote&sortBy=DD',[\s\S]*?\];/, "return [\n" +
"    'https://www.linkedin.com/jobs/search?keywords=Full+Stack+Developer&location=Remote&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=Software+Engineer&location=Remote&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=Frontend+Developer&location=Remote&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=Backend+Developer&location=Remote&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=React+Developer&location=Remote&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=WordPress+Developer&location=Remote&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=Shopify+Developer&location=Remote&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=Ecommerce+Developer&location=Remote&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=Laravel+Developer&location=Remote&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=PHP+Developer&location=Remote&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=SEO+Specialist&location=Remote&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=Web+Developer&location=Remote&sortBy=DD',\n\n" +
"    'https://www.linkedin.com/jobs/search?keywords=software+engineer+Abuja&f_WT=1&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=full+stack+developer+Lagos&f_WT=1&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=frontend+developer+Lagos&f_WT=1&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=backend+developer+Lagos&f_WT=1&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=react+developer+Lagos&f_WT=1&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=php+developer+Lagos&f_WT=1&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=software+developer+Abuja&f_WT=1&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=web+developer+Abuja&f_WT=1&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=IT+Abuja&f_WT=1&sortBy=DD',\n" +
"    'https://www.linkedin.com/jobs/search?keywords=remote+developer+Nigeria&sortBy=DD'\n" +
"  ];");

// 2. Add UAs and Backoff
liCode = liCode.replace(/import \{ getPlaywrightProxy \} from '\.\.\/proxyRotator\.js';/, "import { getPlaywrightProxy } from '../proxyRotator.js';\n\n" +
"const MODERN_UAS = [\n" +
"  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',\n" +
"  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',\n" +
"  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',\n" +
"  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0',\n" +
"  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Edge/120.0.0.0 Safari/537.36'\n" +
"];\n\n" +
"async function fetchWithBackoff(fetchFn, maxRetries = 3) {\n" +
"  for (let i = 0; i < maxRetries; i++) {\n" +
"    try {\n" +
"      return await fetchFn();\n" +
"    } catch (err) {\n" +
"      if (err.message.includes('403') || err.message.includes('429') || err.message.includes('blocked') || err.message.includes('failed') || err.message.includes('CAPTCHA')) {\n" +
"        if (i === maxRetries - 1) throw err;\n" +
"        await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000 + Math.random() * 500));\n" +
"      } else {\n" +
"        throw err;\n" +
"      }\n" +
"    }\n" +
"  }\n" +
"}\n");

// 3. Playwright setup update
liCode = liCode.replace(/userAgent: stealthUserAgent,/, "userAgent: MODERN_UAS[Math.floor(Math.random() * MODERN_UAS.length)],");
liCode = liCode.replace(/const result = await fetchLinkedinViaBrightData\(url, mcpToken, \{ sessionId: activeSessionId \}\);/, "const result = await fetchWithBackoff(() => fetchLinkedinViaBrightData(url, mcpToken, { sessionId: activeSessionId }));");

// Error classification during Playwright navigation
liCode = liCode.replace(/await page\.goto\(url, \{ waitUntil: 'domcontentloaded', timeout: 35000 \}\);/, "await fetchWithBackoff(async () => {\n            const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });\n            if (resp) {\n               const status = resp.status();\n               if (status === 403 || status === 429) throw new Error(`Blocked by LinkedIn with status ${status}`);\n               if (status === 999) throw new Error('LinkedIn Session Expired or Hard Block');\n            }\n            const pageText = await page.content();\n            if (pageText.includes('authwall') || pageText.includes('login')) {\n               throw new Error('LinkedIn Session expired');\n            }\n            if (pageText.includes('security check') || pageText.includes('captcha') || pageText.includes('verify you are human')) {\n               throw new Error('CAPTCHA detected');\n            }\n          });");

fs.writeFileSync('src/scrapers/linkedin.js', liCode);
console.log('updated indeed and linkedin');

import { compactText, stripHtml } from '../utils.js';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_HEADERS = {
  Accept: 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36'
};

export async function probeAtsBoard(platform, slug, options = {}) {
  const cleanSlug = normalizeSlug(slug);
  if (!cleanSlug) {
    return { platform, slug, exists: false, jobCount: 0, remoteJobCount: 0, sampleTitles: [], error: 'Invalid slug' };
  }

  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);

  switch (platform.toLowerCase()) {
    case 'greenhouse':
      return probeGreenhouse(cleanSlug, timeoutSignal);
    case 'ashby':
      return probeAshby(cleanSlug, timeoutSignal);
    case 'lever':
      return probeLever(cleanSlug, timeoutSignal);
    case 'bamboohr':
      return probeBambooHR(cleanSlug, timeoutSignal);
    case 'breezyhr':
    case 'breezy':
      return probeBreezyHR(cleanSlug, timeoutSignal);
    case 'smartrecruiters':
      return probeSmartRecruiters(cleanSlug, timeoutSignal);
    case 'workable':
      return probeWorkable(cleanSlug, timeoutSignal);
    default:
      return { platform, slug: cleanSlug, exists: false, jobCount: 0, remoteJobCount: 0, sampleTitles: [], error: `Unsupported platform: ${platform}` };
  }
}

async function probeGreenhouse(slug, signal) {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=false`;
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS, signal });
    if (!res.ok) {
      return { platform: 'greenhouse', slug, exists: false, jobCount: 0, remoteJobCount: 0, sampleTitles: [] };
    }
    const data = await res.json();
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    const remoteJobs = jobs.filter((j) => /remote|anywhere|worldwide/i.test(`${j.location?.name || ''} ${j.title || ''}`));
    const sampleTitles = jobs.slice(0, 5).map((j) => compactText(j.title)).filter(Boolean);

    return {
      platform: 'greenhouse',
      slug,
      exists: true,
      jobCount: jobs.length,
      remoteJobCount: remoteJobs.length,
      sampleTitles,
      boardUrl: `https://job-boards.greenhouse.io/${slug}`
    };
  } catch (err) {
    return { platform: 'greenhouse', slug, exists: false, jobCount: 0, remoteJobCount: 0, sampleTitles: [], error: err.message };
  }
}

async function probeAshby(slug, signal) {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`;
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS, signal });
    if (!res.ok) {
      return { platform: 'ashby', slug, exists: false, jobCount: 0, remoteJobCount: 0, sampleTitles: [] };
    }
    const data = await res.json();
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    const remoteJobs = jobs.filter((j) => Boolean(j.isRemote) || /remote|anywhere|worldwide/i.test(`${j.location || ''} ${j.title || ''}`));
    const sampleTitles = jobs.slice(0, 5).map((j) => compactText(j.title)).filter(Boolean);

    return {
      platform: 'ashby',
      slug,
      exists: true,
      jobCount: jobs.length,
      remoteJobCount: remoteJobs.length,
      sampleTitles,
      boardUrl: `https://jobs.ashbyhq.com/${slug}`
    };
  } catch (err) {
    return { platform: 'ashby', slug, exists: false, jobCount: 0, remoteJobCount: 0, sampleTitles: [], error: err.message };
  }
}

async function probeLever(slug, signal) {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`;
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS, signal });
    if (!res.ok) {
      return { platform: 'lever', slug, exists: false, jobCount: 0, remoteJobCount: 0, sampleTitles: [] };
    }
    const data = await res.json();
    const jobs = Array.isArray(data) ? data : [];
    const remoteJobs = jobs.filter((j) => /remote|anywhere|worldwide/i.test(`${j.categories?.location || ''} ${j.text || ''}`));
    const sampleTitles = jobs.slice(0, 5).map((j) => compactText(j.text)).filter(Boolean);

    return {
      platform: 'lever',
      slug,
      exists: true,
      jobCount: jobs.length,
      remoteJobCount: remoteJobs.length,
      sampleTitles,
      boardUrl: `https://jobs.lever.co/${slug}`
    };
  } catch (err) {
    return { platform: 'lever', slug, exists: false, jobCount: 0, remoteJobCount: 0, sampleTitles: [], error: err.message };
  }
}

async function probeBambooHR(slug, signal) {
  const url = `https://${encodeURIComponent(slug)}.bamboohr.com/careers/list`;
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS, signal });
    if (!res.ok) {
      return { platform: 'bamboohr', slug, exists: false, jobCount: 0, remoteJobCount: 0, sampleTitles: [] };
    }
    const data = await res.json();
    const jobs = Array.isArray(data?.result) ? data.result : [];
    const remoteJobs = jobs.filter((j) => Boolean(j.isRemote) || /remote/i.test(`${j.location || ''} ${j.jobOpeningName || j.title || ''}`));
    const sampleTitles = jobs.slice(0, 5).map((j) => compactText(j.jobOpeningName || j.title)).filter(Boolean);

    return {
      platform: 'bamboohr',
      slug,
      exists: true,
      jobCount: jobs.length,
      remoteJobCount: remoteJobs.length,
      sampleTitles,
      boardUrl: `https://${slug}.bamboohr.com/careers`
    };
  } catch (err) {
    return { platform: 'bamboohr', slug, exists: false, jobCount: 0, remoteJobCount: 0, sampleTitles: [], error: err.message };
  }
}

async function probeBreezyHR(slug, signal) {
  const url = `https://${encodeURIComponent(slug)}.breezy.hr/json`;
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS, signal });
    if (!res.ok) {
      return { platform: 'breezyhr', slug, exists: false, jobCount: 0, remoteJobCount: 0, sampleTitles: [] };
    }
    const data = await res.json();
    const jobs = Array.isArray(data) ? data : [];
    const remoteJobs = jobs.filter((j) => Boolean(j.location?.is_remote) || /remote/i.test(`${j.location?.name || ''} ${j.name || ''}`));
    const sampleTitles = jobs.slice(0, 5).map((j) => compactText(j.name)).filter(Boolean);

    return {
      platform: 'breezyhr',
      slug,
      exists: true,
      jobCount: jobs.length,
      remoteJobCount: remoteJobs.length,
      sampleTitles,
      boardUrl: `https://${slug}.breezy.hr`
    };
  } catch (err) {
    return { platform: 'breezyhr', slug, exists: false, jobCount: 0, remoteJobCount: 0, sampleTitles: [], error: err.message };
  }
}

async function probeSmartRecruiters(slug, signal) {
  const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=25`;
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS, signal });
    if (!res.ok) {
      return { platform: 'smartrecruiters', slug, exists: false, jobCount: 0, remoteJobCount: 0, sampleTitles: [] };
    }
    const data = await res.json();
    const jobs = Array.isArray(data?.content) ? data.content : [];
    const remoteJobs = jobs.filter((j) => Boolean(j.location?.remote) || /remote|anywhere|worldwide/i.test(`${j.location?.fullLocation || ''} ${j.location?.region || ''} ${j.name || ''}`));
    const sampleTitles = jobs.slice(0, 5).map((j) => compactText(j.name || j.title)).filter(Boolean);

    return {
      platform: 'smartrecruiters',
      slug,
      exists: jobs.length > 0 || (data && typeof data.totalFound === 'number' && data.totalFound > 0),
      jobCount: data?.totalFound ?? jobs.length,
      remoteJobCount: remoteJobs.length,
      sampleTitles,
      boardUrl: `https://jobs.smartrecruiters.com/${slug}`
    };
  } catch (err) {
    return { platform: 'smartrecruiters', slug, exists: false, jobCount: 0, remoteJobCount: 0, sampleTitles: [], error: err.message };
  }
}

async function probeWorkable(slug, signal) {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}?details=false`;
  try {
    const res = await fetch(url, { headers: DEFAULT_HEADERS, signal });
    if (!res.ok) {
      return { platform: 'workable', slug, exists: false, jobCount: 0, remoteJobCount: 0, sampleTitles: [] };
    }
    const data = await res.json();
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    const remoteJobs = jobs.filter((j) => Boolean(j.telecommuting) || /remote|anywhere|worldwide/i.test(`${j.city || ''} ${j.country || ''} ${j.title || ''}`));
    const sampleTitles = jobs.slice(0, 5).map((j) => compactText(j.title)).filter(Boolean);

    return {
      platform: 'workable',
      slug,
      exists: true,
      jobCount: jobs.length,
      remoteJobCount: remoteJobs.length,
      sampleTitles,
      boardUrl: `https://apply.workable.com/${slug}`
    };
  } catch (err) {
    return { platform: 'workable', slug, exists: false, jobCount: 0, remoteJobCount: 0, sampleTitles: [], error: err.message };
  }
}

export async function discoverActiveBoards(platform, candidateSlugs = [], options = {}) {
  const concurrency = Math.max(1, Number.parseInt(options.concurrency, 10) || 5);
  const results = [];
  const slugs = [...new Set(candidateSlugs.map(normalizeSlug).filter(Boolean))];

  for (let i = 0; i < slugs.length; i += concurrency) {
    const batch = slugs.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((slug) => probeAtsBoard(platform, slug, options))
    );
    for (const res of batchResults) {
      if (res.exists && res.jobCount > 0) {
        results.push(res);
      }
    }
  }

  return results;
}

export async function findMatchingJobsAcrossAts(platforms = ['greenhouse', 'ashby', 'lever', 'bamboohr'], candidateSlugs = [], matchPattern, options = {}) {
  const activeBoards = [];
  for (const platform of platforms) {
    const found = await discoverActiveBoards(platform, candidateSlugs, options);
    activeBoards.push(...found);
  }

  const regex = matchPattern instanceof RegExp ? matchPattern : new RegExp(String(matchPattern || ''), 'i');
  return activeBoards.map((board) => {
    const matchingTitles = board.sampleTitles.filter((t) => regex.test(t));
    return {
      ...board,
      hasMatchingJobs: matchingTitles.length > 0,
      matchingTitles
    };
  });
}

function normalizeSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+\//, '')
    .replace(/[^a-z0-9_-]/g, '');
}

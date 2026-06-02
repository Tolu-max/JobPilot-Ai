import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { GoogleGenAI } from '@google/genai';
import { hashJob } from './jobStore.js';
import lockfile from 'proper-lockfile';

async function ensureFileExists(filepath, initialContent = '{"items":{}}') {
  try {
    await fs.access(filepath);
  } catch {
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, initialContent, 'utf8');
  }
}

export const TaskTypes = Object.freeze({
  FAST_FILTER: 'FAST_FILTER',
  APPLICATION_WRITING: 'APPLICATION_WRITING',
  JOB_VERIFICATION: 'JOB_VERIFICATION',
  HIGH_VALUE_APPLICATION: 'HIGH_VALUE_APPLICATION',
  FALLBACK_REASONING: 'FALLBACK_REASONING'
});

const ROUTES = {
  [TaskTypes.FAST_FILTER]: [
    { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', costLevel: 'free' },
    { provider: 'groq', model: 'llama-3.3-70b-versatile', costLevel: 'low' },
    { provider: 'gemini', model: 'gemini-2.0-flash', costLevel: 'medium' }
  ],
  [TaskTypes.APPLICATION_WRITING]: [
    { provider: 'groq', model: 'llama-3.3-70b-versatile', costLevel: 'medium' },
    { provider: 'gemini', model: 'gemini-2.0-flash', costLevel: 'medium' },
    { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', costLevel: 'free' }
  ],
  [TaskTypes.JOB_VERIFICATION]: [
    { provider: 'groq', model: 'llama-3.3-70b-versatile', costLevel: 'low' },
    { provider: 'gemini', model: 'gemini-2.0-flash', costLevel: 'medium' },
    { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', costLevel: 'free' }
  ],
  [TaskTypes.HIGH_VALUE_APPLICATION]: [
    { provider: 'groq', model: 'llama-3.3-70b-versatile', costLevel: 'medium' },
    { provider: 'gemini', model: 'gemini-2.0-flash', costLevel: 'medium' },
    { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', costLevel: 'free' }
  ],
  [TaskTypes.FALLBACK_REASONING]: [
    { provider: 'groq', model: 'llama-3.3-70b-versatile', costLevel: 'low' },
    { provider: 'gemini', model: 'gemini-2.0-flash', costLevel: 'medium' },
    { provider: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct', costLevel: 'free' }
  ]
};

export async function request({ taskType, prompt, profile = {}, jobData = {}, fallbackLevel = 'normal', config = {} }) {
  const startedAt = Date.now();
  const normalizedTaskType = normalizeTaskType(taskType);
  const profileName = profile.profileName || profile.name || config.profileName || 'default';
  const localScore = Number.parseInt(jobData.localScore ?? jobData.local_score ?? jobData.score, 10);
  const cachePath = resolveCachePath(config);
  const cacheKey = buildCacheKey({ normalizedTaskType, prompt, profileName, jobData });
  const route = routeFor(normalizedTaskType, localScore);

  if (isMockAiMode(config)) {
    return simulateMockRouting({
      route,
      normalizedTaskType,
      prompt,
      profileName,
      jobData,
      fallbackLevel,
      config,
      startedAt
    });
  }

  if (normalizedTaskType === TaskTypes.JOB_VERIFICATION && Number.isFinite(localScore) && localScore < 55) {
    return failSafeResponse({
      modelUsed: 'local-rules',
      response: localRulesResponse(jobData, 'Local score is below 55; AI verification skipped by cost-control rule.'),
      fallbackUsed: true
    });
  }

  if (normalizedTaskType === TaskTypes.HIGH_VALUE_APPLICATION && (!Number.isFinite(localScore) || localScore < 90)) {
    return failSafeResponse({
      modelUsed: 'local-rules',
      response: localRulesResponse(jobData, 'High-value model skipped because score is below 90.'),
      fallbackUsed: true
    });
  }

  const cached = await readCache(cachePath, cacheKey, config);
  if (cached) {
    await logAiCall(config, {
      timestamp: new Date().toISOString(),
      taskType: normalizedTaskType,
      modelUsed: cached.modelUsed,
      latencyMs: Date.now() - startedAt,
      tokenEstimate: estimateTokens(prompt),
      success: true,
      profile: profileName,
      cacheHit: true
    });
    return { ...cached, fallbackUsed: Boolean(cached.fallbackUsed), cacheHit: true };
  }

  const failures = [];

  for (const target of route) {
    const model = target.modelFromConfig ? config[target.modelFromConfig] || target.defaultModel : target.model;
    if (!hasProviderKey(target.provider, config)) {
      failures.push(`${target.provider}/${model}: missing API key`);
      continue;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attemptStartedAt = Date.now();
      try {
        const response = await callProvider(target.provider, model, prompt, config);
        const result = {
          modelUsed: `${target.provider}:${model}`,
          response,
          confidence: confidenceFor(normalizedTaskType, attempt),
          costLevel: target.costLevel,
          fallbackUsed: failures.length > 0 || attempt > 0
        };
        await writeCache(cachePath, cacheKey, result, { taskType: normalizedTaskType, jobData, profileName });
        await logAiCall(config, {
          timestamp: new Date().toISOString(),
          taskType: normalizedTaskType,
          modelUsed: result.modelUsed,
          latencyMs: Date.now() - attemptStartedAt,
          tokenEstimate: estimateTokens(prompt, response),
          success: true,
          profile: profileName,
          fallbackLevel,
          fallbackUsed: result.fallbackUsed
        });
        return result;
      } catch (error) {
        failures.push(`${target.provider}/${model} attempt ${attempt + 1}: ${error.message}`);
        await logAiCall(config, {
          timestamp: new Date().toISOString(),
          taskType: normalizedTaskType,
          modelUsed: `${target.provider}:${model}`,
          latencyMs: Date.now() - attemptStartedAt,
          tokenEstimate: estimateTokens(prompt),
          success: false,
          profile: profileName,
          error: error.message,
          fallbackLevel
        });
      }
    }
  }

  const fallback = failSafeResponse({
    modelUsed: 'local-rules',
    response: localRulesResponse(jobData, `All AI providers failed. ${failures.join(' | ')}`),
    fallbackUsed: true
  });
  await logAiCall(config, {
    timestamp: new Date().toISOString(),
    taskType: normalizedTaskType,
    modelUsed: fallback.modelUsed,
    latencyMs: Date.now() - startedAt,
    tokenEstimate: estimateTokens(prompt),
    success: false,
    profile: profileName,
    error: failures.join(' | ')
  });
  return fallback;
}

async function callProvider(provider, model, prompt, config) {
  if (provider === 'gemini') return callGemini(model, prompt, config);
  if (provider === 'groq') return callOpenAiCompatible('https://api.groq.com/openai/v1/chat/completions', config.groqApiKey, model, prompt);
  if (provider === 'openrouter') {
    return callOpenAiCompatible('https://openrouter.ai/api/v1/chat/completions', config.openRouterApiKey, model, prompt, {
      'HTTP-Referer': config.openRouterSiteUrl || 'http://localhost',
      'X-Title': config.openRouterAppName || 'Job Scrapper'
    });
  }
  throw new Error(`Unsupported provider: ${provider}`);
}

async function callGemini(model, prompt, config) {
  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      temperature: 0.2
    }
  });
  return String(response.text || '').trim();
}

async function callOpenAiCompatible(endpoint, apiKey, model, prompt, extraHeaders = {}) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'Return valid JSON only. Keep answers concise, truthful, and specific.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }

  const payload = await response.json();
  return String(payload.choices?.[0]?.message?.content || '').trim();
}

function routeFor(taskType, localScore) {
  if (taskType === TaskTypes.HIGH_VALUE_APPLICATION && localScore >= 90) {
    return ROUTES[TaskTypes.HIGH_VALUE_APPLICATION];
  }
  return ROUTES[taskType] || ROUTES[TaskTypes.FALLBACK_REASONING];
}

async function simulateMockRouting({
  route,
  normalizedTaskType,
  prompt,
  profileName,
  jobData,
  fallbackLevel,
  config,
  startedAt
}) {
  const failures = [];

  for (const target of route) {
    const model = target.modelFromConfig ? config[target.modelFromConfig] || target.defaultModel : target.model;
    const modelUsed = `${target.provider}:${model}`;
    const forcedFailure = shouldForceMockFailure(config, target.provider, model);
    const latencyMs = Date.now() - startedAt;

    if (forcedFailure) {
      const error = `Forced mock failure for ${modelUsed}`;
      failures.push(error);
      await logAiCall(config, {
        timestamp: new Date().toISOString(),
        taskType: normalizedTaskType,
        modelUsed,
        latencyMs,
        tokenEstimate: estimateTokens(prompt),
        success: false,
        profile: profileName,
        error,
        fallbackLevel
      });
      continue;
    }

    const response = mockResponse(normalizedTaskType, jobData);
    await logAiCall(config, {
      timestamp: new Date().toISOString(),
      taskType: normalizedTaskType,
      modelUsed,
      latencyMs,
      tokenEstimate: estimateTokens(prompt, response),
      success: true,
      profile: profileName,
      fallbackLevel,
      fallbackUsed: failures.length > 0,
      cacheHit: false,
      mock: true
    });
    return {
      modelUsed,
      response,
      confidence: confidenceFor(normalizedTaskType, failures.length > 0 ? 1 : 0),
      costLevel: target.costLevel,
      fallbackUsed: failures.length > 0,
      mock: true
    };
  }

  const fallback = failSafeResponse({
    modelUsed: 'local-rules',
    response: localRulesResponse(jobData, `All mock AI routes failed. ${failures.join(' | ')}`),
    fallbackUsed: true
  });
  await logAiCall(config, {
    timestamp: new Date().toISOString(),
    taskType: normalizedTaskType,
    modelUsed: fallback.modelUsed,
    latencyMs: Date.now() - startedAt,
    tokenEstimate: estimateTokens(prompt),
    success: false,
    profile: profileName,
    error: failures.join(' | '),
    fallbackLevel,
    mock: true
  });
  return fallback;
}

function hasProviderKey(provider, config) {
  if (provider === 'gemini') return Boolean(config.geminiApiKey);
  if (provider === 'groq') return Boolean(config.groqApiKey);
  if (provider === 'openrouter') return Boolean(config.openRouterApiKey);
  return false;
}

function normalizeTaskType(taskType) {
  return Object.values(TaskTypes).includes(taskType) ? taskType : TaskTypes.FALLBACK_REASONING;
}

function buildCacheKey({ normalizedTaskType, prompt, profileName, jobData }) {
  const jobHash = safeJobHash(jobData);
  return crypto
    .createHash('sha256')
    .update(`${normalizedTaskType}|${profileName}|${jobHash}|${prompt}`)
    .digest('hex');
}

function safeJobHash(jobData) {
  try {
    return hashJob(jobData || {});
  } catch {
    return crypto.createHash('sha256').update(JSON.stringify(jobData || {})).digest('hex');
  }
}

async function readCache(cachePath, cacheKey, config = {}) {
  const cache = await loadCache(cachePath);
  const entry = cache.items?.[cacheKey];
  if (!entry) return null;
  // TTL check — default 24 hours, configurable via config.aiCacheMaxAgeHours
  const maxAgeHours = Number.isFinite(config.aiCacheMaxAgeHours) ? config.aiCacheMaxAgeHours : 24;
  if (entry.cachedAt) {
    const ageHours = (Date.now() - new Date(entry.cachedAt).getTime()) / (1000 * 60 * 60);
    if (ageHours > maxAgeHours) return null; // stale — re-fetch
  }
  return entry;
}

async function writeCache(cachePath, cacheKey, result, meta) {
  await ensureFileExists(cachePath);
  let release = () => {};
  try {
    release = await lockfile.lock(cachePath, { retries: 5, stale: 10000 });
    const cache = await loadCache(cachePath);
    cache.items ||= {};
    cache.items[cacheKey] = {
      ...result,
      cachedAt: new Date().toISOString(),
      taskType: meta.taskType,
      profile: meta.profileName,
      jobHash: safeJobHash(meta.jobData)
    };
    await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error(`[aiRouter] Cache lock error:`, error.message);
  } finally {
    await release();
  }
}

async function loadCache(cachePath) {
  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf8'));
  } catch {
    return { items: {} };
  }
}

/**
 * Remove cache entries older than maxAgeHours. Call this at startup.
 */
export async function pruneAiCache(cachePath, maxAgeHours = 24) {
  await ensureFileExists(cachePath);
  let release = () => {};
  try {
    release = await lockfile.lock(cachePath, { retries: 2, stale: 10000 });
    const cache = await loadCache(cachePath);
    if (!cache.items) return;
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000;
    let pruned = 0;
    for (const key of Object.keys(cache.items)) {
      const entry = cache.items[key];
      if (entry.cachedAt && new Date(entry.cachedAt).getTime() < cutoff) {
        delete cache.items[key];
        pruned++;
      }
    }
    if (pruned > 0) {
      await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
      console.log(`[aiRouter] Pruned ${pruned} stale cache entries (>${maxAgeHours}h old).`);
    }
  } catch { /* non-fatal */ } finally {
    await release();
  }
}

async function logAiCall(config, entry) {
  const logPath = config.aiRouterLogPath || path.resolve(config.rootDir || process.cwd(), 'logs', 'aiRouter.log');
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
}

function resolveCachePath(config) {
  return config.aiCachePath || path.resolve(config.rootDir || process.cwd(), 'data', 'aiCache.json');
}

function estimateTokens(...values) {
  const chars = values.map((value) => String(value || '')).join('').length;
  return Math.ceil(chars / 4);
}

function confidenceFor(taskType, attempt) {
  const base = taskType === TaskTypes.HIGH_VALUE_APPLICATION ? 88 : taskType === TaskTypes.JOB_VERIFICATION ? 82 : 74;
  return Math.max(40, base - attempt * 8);
}

function failSafeResponse({ modelUsed, response, fallbackUsed }) {
  return {
    modelUsed,
    response,
    confidence: 0,
    costLevel: 'none',
    fallbackUsed
  };
}

function localRulesResponse(jobData, reason) {
  const score = Number.parseInt(jobData.localScore ?? jobData.score, 10);
  const adjustedScore = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  return JSON.stringify({
    adjusted_score: adjustedScore,
    confidence: 0,
    should_apply: adjustedScore >= 65,
    reasoning: reason,
    ats_risk: 'unknown',
    improved_cover_letter: '',
    application_answers: {},
    review_required: true,
    provider_failed: true
  });
}

function mockResponse(taskType, jobData) {
  const score = Math.max(0, Math.min(100, Number.parseInt(jobData.localScore ?? jobData.score, 10) || 80));
  if (taskType === TaskTypes.APPLICATION_WRITING || taskType === TaskTypes.HIGH_VALUE_APPLICATION) {
    return JSON.stringify({
      cover_letter: `Mock routed cover letter for ${jobData.title || 'this role'}.`,
      application_answers: {
        why_good_fit: 'This is a mock routed response based on the candidate profile and job details.'
      }
    });
  }
  return JSON.stringify({
    adjusted_score: score,
    confidence: 80,
    should_apply: score >= 75,
    reasoning: 'MOCK aiRouter verification completed without external API usage.',
    ats_risk: score >= 75 ? 'low' : 'medium',
    improved_cover_letter: `Mock routed cover letter for ${jobData.title || 'this role'}.`,
    application_answers: {
      why_good_fit: 'This is a mock routed response based on the candidate profile and job details.'
    },
    verification_failed: false
  });
}

function isMockAiMode(config = {}) {
  return String(config.aiMode || process.env.AI_MODE || '').trim().toUpperCase() === 'MOCK';
}

function shouldForceMockFailure(config = {}, provider, model) {
  const rawFailures = config.aiRouterForcedFailures || process.env.AI_ROUTER_FORCED_FAILURES || '';
  const failures = Array.isArray(rawFailures) ? rawFailures : String(rawFailures).split(',');
  const normalized = failures.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
  const providerKey = String(provider || '').toLowerCase();
  const modelKey = `${providerKey}:${String(model || '').toLowerCase()}`;
  return normalized.includes(providerKey) || normalized.includes(modelKey);
}

const aiRouter = { request, TaskTypes };

export default aiRouter;

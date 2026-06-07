import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(new URL('../package.json', import.meta.url)));

export function buildConfig(argv = process.argv) {
  const profileName = resolveProfileName(argv);
  const testPlatformMode = readBoolean(process.env.TEST_PLATFORM_MODE, false);
  const e2eTestMode = readBoolean(process.env.E2E_TEST_MODE, false);
  const profileDir = path.resolve(rootDir, 'profiles', profileName);
  const preferencesPath = path.join(profileDir, 'preferences.json');
  const preferences = readJsonSync(preferencesPath, {});
  const displayName = preferences.displayName || profileName;
  const careerBrainPromptPath = path.resolve(
    rootDir,
    'prompts',
    preferences.careerBrainPrompt || `${profileName}CareerBrain.txt`
  );
  const careerBrainPrompt = readTextSync(careerBrainPromptPath, '');
  const envPrefix = profileName.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const sitesConfigPath = path.resolve(rootDir, 'config', 'sites.json');
  const scraperLimit = readNumber(process.env.SCRAPER_LIMIT, 3);
  const maxJobsPerRun = readNumber(
    process.env[`${envPrefix}_MAX_JOBS_PER_RUN`] || process.env.MAX_JOBS_PER_RUN,
    preferences.maxJobsPerRun ?? 0
  );
  const hasMaxJobsOverride = Boolean(process.env[`${envPrefix}_MAX_JOBS_PER_RUN`] || process.env.MAX_JOBS_PER_RUN);
  const platformMaxJobsPerSite = readNumber(process.env.TEST_PLATFORM_MAX_JOBS_PER_SITE, scraperLimit);
  const controlledLimit = Math.min(scraperLimit, platformMaxJobsPerSite);
  const effectiveMaxJobsPerRun = testPlatformMode || e2eTestMode ? Math.min(maxJobsPerRun, controlledLimit) : maxJobsPerRun;
  const enabledSitesOverride =
    readOptionalCsv(process.env[`${envPrefix}_ENABLED_SITES`] || process.env.ENABLED_SITES) ??
    readOptionalList(preferences.enabledSites);
  const sitePriority =
    readOptionalCsv(process.env[`${envPrefix}_SITE_PRIORITY`] || process.env.SITE_PRIORITY) ??
    readOptionalList(preferences.sitePriority) ??
    [];
  const sites = buildSites({
    fileSites: readJsonSync(sitesConfigPath, defaultSitesConfig()),
    preferenceSites: preferences.sites || {},
    enabledSitesOverride,
    sitePriority,
    siteLimits: preferences.siteLimits || {},
    maxJobsPerRun: effectiveMaxJobsPerRun,
    capSiteLimits: hasMaxJobsOverride,
    testPlatformMode,
    e2eTestMode,
    platformMaxJobsPerSite,
    envPrefix,
    env: process.env
  });
  const aiMode = normalizeAiMode(process.env.AI_MODE || (testPlatformMode ? 'MOCK' : 'REAL'));

  return {
    rootDir,
    profileName,
    userId: preferences.userId || profileName,
    displayName,
    profileDir,
    preferences,
    preferencesPath,
    sitesConfigPath,
    careerBrainPromptPath,
    careerBrainPrompt,
    jobsUrl: 'https://bruntworkcareers.co/search',
    applyUrlPattern: 'https://apply.bruntworkcareers.co/jobs/',
    userProfile: preferences.userProfileSummary || '',
    testPlatformMode,
    e2eTestMode,
    platformScrapeMode: normalizePlatformScrapeMode(process.env.TEST_PLATFORM_SCRAPE_MODE || 'mock'),
    aiMode,
    aiProvider: normalizeAiProvider(process.env.AI_PROVIDER || process.env.AI_LAYER || 'gemini'),
    aiDisabledProviders: process.env.AI_DISABLED_PROVIDERS || process.env.DISABLED_AI_PROVIDERS || '',
    geminiApiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
    geminiProModel: process.env.GEMINI_PRO_MODEL || 'gemini-1.5-pro',
    groqApiKey: process.env.GROQ_API_KEY || '',
    groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    openRouterApiKey: process.env.OPENROUTER_API_KEY || '',
    openRouterModel: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct',
    openRouterSiteUrl: process.env.OPENROUTER_SITE_URL || 'http://localhost',
    openRouterAppName: process.env.OPENROUTER_APP_NAME || 'JobPilot',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
    deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    deepseekThinking: String(process.env.DEEPSEEK_THINKING || 'disabled').trim().toLowerCase() === 'enabled' ? 'enabled' : 'disabled',
    deepseekMaxTokens: readNumber(process.env.DEEPSEEK_MAX_TOKENS, 0),
    deepseekFastFilterMaxTokens: readNumber(process.env.DEEPSEEK_FAST_FILTER_MAX_TOKENS, 350),
    deepseekVerificationMaxTokens: readNumber(process.env.DEEPSEEK_VERIFICATION_MAX_TOKENS, 450),
    deepseekApplicationMaxTokens: readNumber(process.env.DEEPSEEK_APPLICATION_MAX_TOKENS, 900),
    aiCachePath: path.resolve(rootDir, 'data', 'aiCache.json'),
    aiRouterLogPath: path.resolve(rootDir, 'logs', 'aiRouter.log'),
    applicantEmail: process.env[`${envPrefix}_APPLICANT_EMAIL`] || process.env.APPLICANT_EMAIL || preferences.applicantEmail || '',
    himalayasEmail: process.env[`${envPrefix}_HIMALAYAS_EMAIL`] || process.env.HIMALAYAS_EMAIL || '',
    himalayasPassword: process.env[`${envPrefix}_HIMALAYAS_PASSWORD`] || process.env.HIMALAYAS_PASSWORD || '',
    jobbermanEmail: process.env[`${envPrefix}_JOBBERMAN_EMAIL`] || process.env.JOBBERMAN_EMAIL || '',
    jobbermanPassword: process.env[`${envPrefix}_JOBBERMAN_PASSWORD`] || process.env.JOBBERMAN_PASSWORD || '',
    himalayasBrowserProfileDir: resolveProfilePath(
      rootDir,
      profileDir,
      process.env[`${envPrefix}_HIMALAYAS_BROWSER_PROFILE_DIR`] || process.env.HIMALAYAS_BROWSER_PROFILE_DIR || path.join('..', '..', 'browser-profiles', `${profileName}-himalayas`)
    ),
    voiceRecordingUrl: process.env[`${envPrefix}_VOICE_RECORDING_URL`] || process.env.VOICE_RECORDING_URL || preferences.voiceRecordingUrl || '',
    voiceRecordingPath: resolveOptionalProfilePath(
      rootDir,
      profileDir,
      process.env[`${envPrefix}_VOICE_RECORDING_PATH`] || process.env.VOICE_RECORDING_PATH || preferences.voiceRecordingPath
    ),
    applicationDefaults: preferences.applicationDefaults || {},
    resumePath: resolveProfilePath(
      rootDir,
      profileDir,
      process.env[`${envPrefix}_RESUME_PATH`] || preferences.resumePath || 'resume.pdf'
    ),
    resumePlaceholder: Boolean(preferences.resumePlaceholder),
    candidateProfilePath: path.join(profileDir, 'candidateProfile.json'),
    jobStorePath: path.join(profileDir, 'processedJobs.json'),
    globalJobStorePath: path.resolve(rootDir, 'data', 'globalProcessedJobs.json'),
    reviewPath: path.resolve(rootDir, 'review', 'jobs.json'),
    logPath: path.resolve(rootDir, 'logs', `${profileName}.log`),
    aiRouterLogPath: path.resolve(rootDir, 'logs', 'aiRouter.log'),
    aiCachePath: path.resolve(rootDir, 'data', 'aiCache.json'),
    aiCacheMaxAgeHours: readNumber(
      process.env[`${envPrefix}_AI_CACHE_MAX_AGE_HOURS`] || process.env.AI_CACHE_MAX_AGE_HOURS,
      preferences.aiCacheMaxAgeHours ?? 48
    ),
    debugRootDir: path.resolve(rootDir, 'debug'),
    testResultsDir: path.resolve(rootDir, 'test-results', profileName),
    browserProfileDir: resolveProfilePath(
      rootDir,
      profileDir,
      process.env[`${envPrefix}_BROWSER_PROFILE_DIR`] || preferences.browserProfileDir || path.join('..', '..', 'browser-profiles', profileName)
    ),
    autoApply: readBoolean(process.env[`${envPrefix}_AUTO_APPLY`], readBoolean(process.env.AUTO_APPLY, preferences.autoApply === true)),
    noRealSubmission: readBoolean(process.env.NO_REAL_SUBMISSION, false),
    testMode:
      testPlatformMode ||
      e2eTestMode ||
      readBoolean(process.env.NO_REAL_SUBMISSION, false) ||
      readBoolean(process.env[`${envPrefix}_TEST_MODE`], readBoolean(process.env.TEST_MODE, preferences.testMode === true)),
    maxAutoApplyPerRun: readNumber(
      process.env[`${envPrefix}_MAX_AUTO_APPLY_PER_RUN`] || process.env.MAX_AUTO_APPLY_PER_RUN,
      preferences.maxAutoApplyPerRun ?? 1
    ),
    maxJobsPerRun: effectiveMaxJobsPerRun,
    geminiMinLocalScore: readNumber(
      process.env[`${envPrefix}_GEMINI_MIN_LOCAL_SCORE`] || process.env.GEMINI_MIN_LOCAL_SCORE,
      preferences.minLocalScoreForAi ?? 75
    ),
    schedulerIntervalMs: readNumber(
      process.env[`${envPrefix}_SCHEDULER_INTERVAL_MS`] || process.env.SCHEDULER_INTERVAL_MS,
      preferences.schedulerIntervalMs ?? 4 * 60 * 60 * 1000
    ),
    captchaWaitMs: Number.parseInt(process.env.CAPTCHA_WAIT_MS || String(10 * 60 * 1000), 10),
    applicationTimeoutMs: Number.parseInt(process.env.APPLICATION_TIMEOUT_MS || String(3 * 60 * 1000), 10),
    sites,
    enabledSites: Object.entries(sites)
      .filter(([, siteConfig]) => siteConfig.enabled)
      .map(([site]) => site),
    sitePriority,
    siteLimits: preferences.siteLimits || {},
    siteRunStatePath: path.join(profileDir, 'siteRunState.json'),
    allowDuplicateJobs: readBoolean(
      process.env[`${envPrefix}_ALLOW_DUPLICATE_JOBS`] || process.env.ALLOW_DUPLICATE_JOBS,
      preferences.allowDuplicateJobs === true
    ),
    telegramBotToken: process.env[`${envPrefix}_TELEGRAM_BOT_TOKEN`] || process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env[`${envPrefix}_TELEGRAM_CHAT_ID`] || process.env.TELEGRAM_CHAT_ID || '',
    notificationRoutes: preferences.notificationRoutes || {},
    headless: readBoolean(process.env.HEADLESS, true),
    allowGatewayAutoSubmit: readBoolean(
      process.env[`${envPrefix}_ALLOW_GATEWAY_AUTO_SUBMIT`] || process.env.ALLOW_GATEWAY_AUTO_SUBMIT,
      preferences.allowGatewayAutoSubmit === true || preferences.allowGatewayLiveHandoff === true
    ),
    captchaSolvApiKey: process.env.CAPTCHASOLV_API_KEY || '',
    capsolverApiKey: process.env.CAPSOLVER_API_KEY || '',
    captchaSolverTimeoutMs: Number.parseInt(process.env.CAPTCHA_SOLVER_TIMEOUT_MS || String(45 * 1000), 10),
    minDelayMs: readNumber(
      process.env[`${envPrefix}_MIN_DELAY_MS`] || process.env.MIN_DELAY_MS,
      preferences.minDelayMs ?? 2000
    ),
    maxDelayMs: readNumber(
      process.env[`${envPrefix}_MAX_DELAY_MS`] || process.env.MAX_DELAY_MS,
      preferences.maxDelayMs ?? 6000
    ),
    peakHoursEnabled: readBoolean(
      process.env[`${envPrefix}_PEAK_HOURS_ENABLED`] || process.env.PEAK_HOURS_ENABLED,
      preferences.peakHoursEnabled === true
    ),
    peakHoursStart: process.env[`${envPrefix}_PEAK_HOURS_START`] || process.env.PEAK_HOURS_START || preferences.peakHoursStart || '08:00',
    peakHoursEnd: process.env[`${envPrefix}_PEAK_HOURS_END`] || process.env.PEAK_HOURS_END || preferences.peakHoursEnd || '10:00',
    peakDays: readCsv(process.env[`${envPrefix}_PEAK_DAYS`] || process.env.PEAK_DAYS, preferences.peakDays || ['1','2','3'])
  };
}

function resolveProfileName(argv) {
  const inline = argv.find((arg) => arg.startsWith('--profile='));
  if (inline) return normalizeProfileName(inline.split('=').slice(1).join('='));

  const profileFlagIndex = argv.findIndex((arg) => arg === '--profile');
  if (profileFlagIndex >= 0 && argv[profileFlagIndex + 1]) {
    return normalizeProfileName(argv[profileFlagIndex + 1]);
  }

  return normalizeProfileName(process.env.PROFILE || 'main');
}

function normalizeProfileName(value) {
  const normalized = String(value || 'main').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '');
  return normalized || 'main';
}

function readJsonSync(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function readTextSync(filePath, fallback) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return fallback;
  }
}

function readCsv(value, fallback) {
  if (!value) return Array.isArray(fallback) ? fallback : [];
  if (Array.isArray(value)) return parseSiteList(value);
  return String(value)
    .split(/[\s,;|]+/)
    .map(normalizeSiteName)
    .filter(Boolean);
}

function readOptionalCsv(value) {
  if (!value) return null;
  return readCsv(value, []);
}

function readOptionalList(value) {
  if (value === undefined || value === null || value === '') return null;
  return readCsv(value, []);
}

export function parseSiteList(values) {
  return values
    .flatMap((value) => String(value || '').split(/[\s,;|]+/))
    .map(normalizeSiteName)
    .filter(Boolean);
}

function buildSites({
  fileSites,
  preferenceSites,
  enabledSitesOverride,
  sitePriority,
  siteLimits,
  maxJobsPerRun,
  capSiteLimits,
  testPlatformMode,
  e2eTestMode,
  platformMaxJobsPerSite,
  envPrefix,
  env = process.env
}) {
  const merged = {};
  const siteNames = new Set([
    ...Object.keys(defaultSitesConfig()),
    ...Object.keys(fileSites || {}),
    ...Object.keys(preferenceSites || {}),
    ...(enabledSitesOverride || [])
  ]);

  for (const rawName of siteNames) {
    const site = normalizeSiteName(rawName);
    if (!site) continue;

    merged[site] = {
      enabled: false,
      priority: 999,
      maxJobsPerRun,
      cooldownMinutes: 1,
      autoApplyEnabled: false,
      ...(defaultSitesConfig()[site] || {}),
      ...(fileSites?.[rawName] || fileSites?.[site] || {}),
      ...(preferenceSites?.[rawName] || preferenceSites?.[site] || {})
    };

    const siteLimit = siteLimits?.[site] ?? siteLimits?.[rawName];
    if (siteLimit !== undefined) {
      const limitValue = typeof siteLimit === 'object' ? siteLimit.maxJobsPerRun : siteLimit;
      merged[site].maxJobsPerRun = readNumber(limitValue, merged[site].maxJobsPerRun);
    }
    if (capSiteLimits && maxJobsPerRun > 0) {
      merged[site].maxJobsPerRun = Math.min(merged[site].maxJobsPerRun || maxJobsPerRun, maxJobsPerRun);
    }

    if (testPlatformMode || e2eTestMode) {
      merged[site].maxJobsPerRun = Math.min(merged[site].maxJobsPerRun, platformMaxJobsPerSite);
      merged[site].cooldownMinutes = 0;
    }

    applySiteEnvOverrides(merged[site], site, envPrefix, env);
  }

  for (const [index, site] of sitePriority.entries()) {
    if (merged[site]) merged[site].priority = index + 1;
  }

  if (enabledSitesOverride) {
    const enabled = new Set(enabledSitesOverride);
    for (const site of Object.keys(merged)) {
      merged[site].enabled = enabled.has(site);
    }
  }

  return merged;
}

function applySiteEnvOverrides(siteConfig, site, envPrefix, env) {
  const sitePrefix = site.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const scoped = (name) => env[`${envPrefix}_${sitePrefix}_${name}`] ?? env[`${sitePrefix}_${name}`];
  const csvFields = {
    boards: 'BOARDS',
    boardTokens: 'BOARD_TOKENS',
    includeKeywords: 'INCLUDE_KEYWORDS',
    includeTitleKeywords: 'INCLUDE_TITLE_KEYWORDS',
    requireTitleKeywords: 'REQUIRE_TITLE_KEYWORDS',
    excludeKeywords: 'EXCLUDE_KEYWORDS',
    preferredLocations: 'PREFERRED_LOCATIONS',
    categories: 'CATEGORIES',
    queries: 'QUERIES'
  };

  for (const [field, envName] of Object.entries(csvFields)) {
    const value = scoped(envName);
    if (value !== undefined && value !== '') siteConfig[field] = readStringList(value);
  }

  const numericFields = {
    maxJobsPerRun: 'MAX_JOBS_PER_RUN',
    maxAgeDays: 'MAX_AGE_DAYS',
    cooldownMinutes: 'COOLDOWN_MINUTES',
    timeoutMs: 'TIMEOUT_MS'
  };
  for (const [field, envName] of Object.entries(numericFields)) {
    const value = scoped(envName);
    if (value !== undefined && value !== '') siteConfig[field] = readNumber(value, siteConfig[field]);
  }

  const booleanFields = {
    enabled: 'ENABLED',
    autoApplyEnabled: 'AUTO_APPLY_ENABLED',
    remoteOnly: 'REMOTE_ONLY',
    englishOnly: 'ENGLISH_ONLY',
    allowOtherLocationsWhenNoPreferred: 'ALLOW_OTHER_LOCATIONS_WHEN_NO_PREFERRED'
  };
  for (const [field, envName] of Object.entries(booleanFields)) {
    const value = scoped(envName);
    if (value !== undefined && value !== '') siteConfig[field] = readBoolean(value, siteConfig[field]);
  }
}

function readStringList(value) {
  if (Array.isArray(value)) {
    return value.flatMap(readStringList).filter(Boolean);
  }
  return String(value || '')
    .split(/[,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function defaultSitesConfig() {
  return {
    bruntwork: {
      enabled: true,
      priority: 10,
      maxJobsPerRun: 0,
      cooldownMinutes: 1,
      autoApplyEnabled: true
    }
  };
}

function normalizeSiteName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function readBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function readNumber(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveProfilePath(root, profileDir, value) {
  if (path.isAbsolute(value)) return value;
  return path.resolve(profileDir, value);
}

function resolveOptionalProfilePath(root, profileDir, value) {
  return value ? resolveProfilePath(root, profileDir, value) : '';
}

function normalizeAiMode(value) {
  const normalized = String(value || 'REAL').trim().toUpperCase();
  return normalized === 'MOCK' ? 'MOCK' : 'REAL';
}

function normalizeAiProvider(value) {
  const normalized = String(value || 'gemini').trim().toLowerCase();
  if (['gemini', 'groq', 'openrouter', 'deepseek'].includes(normalized)) return normalized;
  return 'gemini';
}

function normalizePlatformScrapeMode(value) {
  const normalized = String(value || 'mock').trim().toLowerCase();
  return normalized === 'limited' ? 'limited' : 'mock';
}

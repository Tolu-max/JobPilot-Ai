import { text, password, select, confirm, multiselect, spinner, isCancel, cancel, note, intro, outro } from '@clack/prompts';
import pc from 'picocolors';
import fs from 'node:fs/promises';
import path from 'node:path';

import { extractResumeIntelligence } from '../resumeIntelligence.js';
import { resolveStoredProfilePath } from '../config.js';
import { upsertEnvVars } from './envFile.js';
import { scraperRegistry } from '../scrapers/index.js';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env');

const DEFAULT_SITES = ['remoteok', 'remotive', 'remotejobsorg'];
const SITE_LABELS = {
  bruntwork: 'BruntWork',
  himalayas: 'Himalayas',
  influx: 'Influx',
  jobberman: 'Jobberman',
  remotejobsorg: 'RemoteJobs.org',
  remoteok: 'RemoteOK',
  remotive: 'Remotive',
  wellfound: 'Wellfound'
};
const SITE_HINTS = {
  bruntwork: 'CAPTCHA-heavy, audited adapter',
  himalayas: 'scrape-first remote roles',
  influx: 'voice/audio requirement, disabled by default',
  jobberman: 'Nigeria remote roles',
  remotejobsorg: 'gateway resolver',
  remoteok: 'remote feed + apply resolver',
  remotive: 'remote feed',
  wellfound: 'scrape-only, often protected'
};
const DEFAULT_HARD_FILTERS = [
  'u.s. work authorization',
  'authorized to work in the united states',
  'security clearance required'
];
const DEFAULT_EXCLUSIONS = ['commission only', 'door to door'];

export async function interactiveInit(args = {}) {
  intro(pc.bgMagenta(pc.black(' JobPilot Profile Setup ')));
  note([
    "Let's build a working profile end-to-end.",
    'The wizard is local-first: your resume is read from disk, and live submit stays off unless you explicitly enable it.',
    'You can re-run this any time to adjust.'
  ].join('\n'));

  // 1. Profile name
  const profileNameRaw = await askText('Profile name (e.g. main, work, sister):', args.profile || args.p || 'main');
  const safeProfile = normalizeProfileName(profileNameRaw);
  const profileDir = path.join(ROOT, 'profiles', safeProfile);
  const profileUpper = safeProfile.toUpperCase();

  // 2. Resume
  note('Step 1/8 — Resume parsing');
  const cvPath = await askText('Path to your resume (PDF, DOCX, or TXT):');
  const resumeAbs = path.isAbsolute(cvPath) ? cvPath : path.resolve(ROOT, cvPath);
  try {
    await fs.access(resumeAbs);
  } catch {
    cancel(`Resume not found: ${resumeAbs}`);
    process.exit(1);
  }

  // 3. AI provider
  note('Step 2/8 — AI provider (used for matching & resume parsing)');
  const aiProvider = await askSelect('Which AI provider do you want to use?', [
    { value: 'deepseek', label: 'DeepSeek', hint: 'bring your own API key' },
    { value: 'gemini', label: 'Gemini  (free tier, recommended)', hint: 'aistudio.google.com' },
    { value: 'openrouter', label: 'OpenRouter', hint: 'openrouter.ai' },
    { value: 'groq', label: 'Groq', hint: 'console.groq.com' },
    { value: 'none', label: 'Skip — local matching only', hint: 'works, but less accurate' }
  ], 'deepseek');

  let aiKey = '';
  if (aiProvider !== 'none') {
    aiKey = await askSecret(`${aiProvider.toUpperCase()} API key:`);
  }

  // 4. Parse resume (now that we have a key)
  const s = spinner();
  s.start('Parsing resume...');
  let resumeIntel = {};
  try {
    resumeIntel = await extractResumeIntelligence(resumeAbs, {
      geminiApiKey: aiProvider === 'gemini' ? aiKey : undefined
    });
    s.stop(pc.green('Resume parsed.'));
  } catch (err) {
    s.stop(pc.red(`Resume parsing failed: ${err.message}`));
    cancel('Setup aborted — fix the resume path or format and re-run.');
    process.exit(1);
  }

  const inferredName    = resumeIntel.name || safeProfile;
  const inferredSkills  = (resumeIntel.skills || []).slice(0, 20);
  const inferredRoles   = resumeIntel.jobTitles || (resumeIntel.jobTitle ? [resumeIntel.jobTitle] : []);
  const inferredSummary = resumeIntel.summary || '';

  note(
    `Parsed from CV:\n` +
    `  ${pc.bold('Name:')}  ${inferredName}\n` +
    `  ${pc.bold('Roles:')} ${inferredRoles.slice(0, 5).join(', ') || '(none)'}\n` +
    `  ${pc.bold('Skills:')} ${inferredSkills.slice(0, 8).join(', ') || '(none)'}`
  );

  // 5. Applicant details + edits
  note('Step 3/8 — Applicant details');
  const email = await askText('Email to submit applications from:', resumeIntel.email || '');
  const displayName = await askText('Display name:', inferredName);
  const targetRolesRaw = await askText(
    'Target roles (comma-separated):',
    inferredRoles.slice(0, 5).join(', ')
  );
  const skillsRaw = await askText(
    'Top skills (comma-separated):',
    inferredSkills.slice(0, 10).join(', ')
  );
  const exclusionsRaw = await askText(
    'Job exclusions / blacklist (comma-separated):',
    DEFAULT_EXCLUSIONS.join(', ')
  );

  // 6. Sites + limits
  note('Step 4/8 — Job sites');
  const enabledSites = await askMulti('Which sites should this profile use?',
    buildSiteOptions()
  );

  const siteLimits = {};
  const sitesConfig = {};
  for (const site of enabledSites) {
    const limit = await askText(`Max jobs per run for ${pc.cyan(site)}:`, defaultSiteLimit(site));
    const n = parseNumberInRange(limit, 1, 100, Number(defaultSiteLimit(site)));
    siteLimits[site] = n;
    sitesConfig[site] = {
      enabled: true,
      maxJobsPerRun: n,
      cooldownMinutes: 60,
      autoApplyEnabled: !isGatewaySite(site) && site !== 'wellfound'
    };
  }

  // 6b. Application defaults (used by BruntWork, Influx, and generic adapters
  // to fill phone/city/country fields). Skipped only if user has zero sites
  // that need them — easier to always ask than gate.
  note('Step 4b/8 — Personal info for application forms');
  const location = splitLocation(resumeIntel.location || '');
  const phone   = await askText('Phone (international format, e.g. +1 555 0123):', resumeIntel.phone || '');
  const city    = await askText('City:', location.city);
  const country = await askText('Country:', location.country);
  const weekendAvailability = await askSelect('Available to work weekends?', [
    { value: 'Yes', label: 'Yes' },
    { value: 'No', label: 'No' },
    { value: 'Sometimes', label: 'Sometimes' }
  ], 'Yes');
  const contractPreference = await askText(
    'Contract preference (free text — shown on long-term/contract questions):',
    'I will only accept long term offers'
  );
  const referralSource = await askText('How you heard about the job (free text):', 'Found via job board');

  let voiceRecordingUrl = '';
  if (enabledSites.includes('bruntwork')) {
    note('BruntWork requires a voice recording link. Record a 30-60s intro at https://voca.ro and paste the share URL here. Leave blank to fill manually later.');
    voiceRecordingUrl = await askText('Voice recording URL (optional):', '');
  }

  const applicationDefaults = {
    fullName: displayName,
    phone,
    city,
    country,
    contractPreference,
    weekendAvailability,
    referralSource
  };

  // 7. Scoring + auto-apply
  note('Step 5/8 — Scoring & auto-apply');
  const minScore = parseNumberInRange(await askText('Minimum local score (0-100) before AI ranks a job:', '60'), 0, 100, 60);
  const runMode = await askSelect('How should this profile run after setup?', [
    { value: 'dry-run', label: 'Safe dry-run', hint: 'fills/audits only, never submits' },
    { value: 'review', label: 'Review queue only', hint: 'scores jobs, you approve manually' },
    { value: 'live', label: 'Live auto-apply', hint: 'advanced: can submit when adapters confirm fit' }
  ], 'dry-run');
  const liveConfirmed = runMode === 'live'
    ? await askConfirm('Confirm live auto-apply? Only use this after dry-run testing.', false)
    : false;
  const autoApply = runMode === 'live' && liveConfirmed;
  const testMode = runMode === 'dry-run' || !autoApply;
  const maxAutoApply = parseNumberInRange(
    await askText('Max auto-applies per run:', autoApply ? '3' : '1'),
    1,
    25,
    autoApply ? 3 : 1
  );
  const maxJobs = parseNumberInRange(await askText('Max jobs to process per run:', autoApply ? '30' : '20'), 1, 200, autoApply ? 30 : 20);
  const gatewaySites = enabledSites.filter(isGatewaySite);
  const allowGatewayAutoSubmit = autoApply && gatewaySites.length > 0
    ? await askConfirm(
      `Allow ${gatewaySites.join(', ')} to hand off to audited apply adapters like Greenhouse?`,
      false
    )
    : false;
  for (const site of gatewaySites) {
    if (sitesConfig[site]) sitesConfig[site].autoApplyEnabled = allowGatewayAutoSubmit;
  }

  // 8. CAPTCHA
  note('Step 6/8 - Paid CAPTCHA solver (only needed for CAPTCHA-protected applications)');
  const captchaProvider = await askSelect('CAPTCHA solver?', [
    { value: 'none', label: 'None - manual review for CAPTCHA forms; headless runs skip them' },
    { value: 'capsolver', label: 'CapSolver (paid)', hint: 'https://www.capsolver.com/' }
  ], enabledSites.includes('bruntwork') ? 'capsolver' : 'none');
  let capsolverKey = '';
  if (captchaProvider === 'capsolver') {
    capsolverKey = await askSecret('CapSolver API key:');
  }

  // 9. Telegram
  note(`Step 7/8 — Telegram notifications (optional)\nYou can skip this and run jobpilot telegram --profile=${safeProfile} later.`);
  const wantsTelegram = await askConfirm('Set up Telegram notifications now?', false);
  let tgToken = '';
  let tgChat = '';
  if (wantsTelegram) {
    note(`Create a bot via @BotFather, then run jobpilot telegram --profile=${safeProfile} if you want guided chat discovery later.`);
    tgToken = await askSecret('Telegram bot token:');
    tgChat  = await askText('Telegram chat ID:');
  }

  // 10. Write files
  note('Step 8/8 — Writing config');
  s.start('Saving profile...');
  await fs.mkdir(profileDir, { recursive: true });
  const storedResume = resolveStoredProfilePath(ROOT, profileDir, resumeAbs);

  const parsedRoles = splitCsv(targetRolesRaw);
  const parsedSkills = splitCsv(skillsRaw);
  const parsedExclusions = splitCsv(exclusionsRaw);

  const preferences = {
    displayName,
    applicantEmail: email,
    resumePath: storedResume.storedValue,
    resumePlaceholder: false,
    careerBrainPrompt: '',
    enabledSites,
    sitePriority: enabledSites,
    siteLimits,
    sites: sitesConfig,
    allowDuplicateJobs: false,
    remotePreference: 'prefer_remote',
    targetSeniorities: ['entry', 'junior', 'mid'],
    hardFilters: DEFAULT_HARD_FILTERS,
    exclusions: parsedExclusions,
    titleExclusions: [],
    autoApply,
    testMode,
    noRealSubmission: runMode === 'dry-run',
    allowGatewayAutoSubmit,
    maxAutoApplyPerRun: maxAutoApply,
    maxJobsPerRun: maxJobs,
    minLocalScoreForAi: minScore,
    schedulerIntervalMs: 4 * 60 * 60 * 1000,
    userProfileSummary: inferredSummary,
    voiceRecordingUrl,
    applicationDefaults
  };

  const candidateProfile = {
    name: displayName,
    portfolioLinks: [resumeIntel.linkedin, resumeIntel.github, resumeIntel.website].filter(Boolean),
    skills: parsedSkills.length ? parsedSkills : inferredSkills,
    strengths: resumeIntel.strengths || [],
    weaknesses: [],
    preferredRoles: parsedRoles.length ? parsedRoles : inferredRoles,
    secondaryRoles: [],
    experienceKeywords: inferredSkills,
    remotePreference: 'prefer_remote',
    targetSeniorities: ['entry', 'junior', 'mid'],
    rejectedJobs: [],
    successfulMatches: [],
    hardFilters: DEFAULT_HARD_FILTERS,
    exclusions: parsedExclusions,
    sourceResume: resumeAbs,
    resumeTextPreview: (resumeIntel.rawTextPreview || '').slice(0, 800),
    lastUpdated: new Date().toISOString()
  };

  await fs.writeFile(path.join(profileDir, 'preferences.json'), JSON.stringify(preferences, null, 2));
  await fs.writeFile(path.join(profileDir, 'candidateProfile.json'), JSON.stringify(candidateProfile, null, 2));
  await fs.writeFile(path.join(profileDir, 'resumeKnowledge.json'), JSON.stringify(resumeIntel, null, 2));

  // 11. .env updates (append-only, never overwrite existing keys)
  const aiKeyEnvName = {
    deepseek: 'DEEPSEEK_API_KEY',
    gemini: 'GEMINI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    groq: 'GROQ_API_KEY'
  }[aiProvider];

  await upsertEnvVars(ENV_PATH, {
    AI_PROVIDER: aiProvider === 'none' ? undefined : aiProvider,
    [aiKeyEnvName]: aiKey || undefined,
    CAPSOLVER_API_KEY: capsolverKey || undefined,
    TELEGRAM_BOT_TOKEN: tgToken || undefined,
    TELEGRAM_CHAT_ID: tgChat || undefined,
    // Per-profile overrides — only set ones the user customised
    [`${profileUpper}_APPLICANT_EMAIL`]: email,
    [`${profileUpper}_RESUME_PATH`]: storedResume.storedValue,
    [`${profileUpper}_AUTO_APPLY`]: String(autoApply),
    [`${profileUpper}_TEST_MODE`]: String(testMode),
    [`${profileUpper}_ALLOW_GATEWAY_AUTO_SUBMIT`]: String(allowGatewayAutoSubmit),
    [`${profileUpper}_MAX_AUTO_APPLY_PER_RUN`]: String(maxAutoApply),
    [`${profileUpper}_MAX_JOBS_PER_RUN`]: String(maxJobs),
    [`${profileUpper}_GEMINI_MIN_LOCAL_SCORE`]: String(minScore),
    [`${profileUpper}_ENABLED_SITES`]: enabledSites.join(',')
  });

  s.stop(pc.green('Profile saved.'));
  outro(
    `${pc.bold(`Profile "${safeProfile}" ready.`)}\n\n` +
    `  Next steps:\n` +
    `    ${pc.cyan(`node cli.js doctor --profile=${safeProfile}`)}  diagnose profile\n` +
    `    ${pc.cyan(`node cli.js run ${safeProfile}`)}               single pass\n` +
    `    ${pc.cyan(`node cli.js scheduler --profile=${safeProfile}`)} long-running\n\n` +
    (autoApply ? pc.yellow('Live auto-apply is ON.') : pc.dim('Live auto-apply is off.')) +
    ` Flip in ${pc.bold(`profiles/${safeProfile}/preferences.json`)} any time.`
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Prompt helpers

async function askText(message, initialValue = '') {
  const result = await text({ message, initialValue });
  if (isCancel(result)) { cancel('Setup aborted.'); process.exit(0); }
  return String(result || '').trim();
}

async function askSecret(message) {
  const result = await password({ message });
  if (isCancel(result)) { cancel('Setup aborted.'); process.exit(0); }
  return String(result || '').trim();
}

async function askSelect(message, options, initialValue) {
  const result = await select({ message, options, initialValue });
  if (isCancel(result)) { cancel('Setup aborted.'); process.exit(0); }
  return result;
}

async function askConfirm(message, initialValue = false) {
  const result = await confirm({ message, initialValue });
  if (isCancel(result)) { cancel('Setup aborted.'); process.exit(0); }
  return Boolean(result);
}

async function askMulti(message, options) {
  const result = await multiselect({ message, options, required: true });
  if (isCancel(result)) { cancel('Setup aborted.'); process.exit(0); }
  return result;
}

export function normalizeProfileName(value) {
  return String(value || 'main').toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^_+|_+$/g, '') || 'main';
}

export function splitCsv(s) {
  return Array.from(new Set(String(s || '').split(',').map((x) => x.trim()).filter(Boolean)));
}

export function parseNumberInRange(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  const n = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, n));
}

export function splitLocation(value) {
  const parts = String(value || '').split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return { city: '', country: '' };
  if (parts.length === 1) return { city: parts[0], country: parts[0] };
  return { city: parts[0], country: parts[parts.length - 1] };
}

export function buildSiteOptions() {
  return Object.entries(scraperRegistry)
    .filter(([, entry]) => entry.implemented)
    .map(([site]) => ({
      value: site,
      label: SITE_LABELS[site] || site,
      hint: SITE_HINTS[site] || 'implemented scraper',
      selected: DEFAULT_SITES.includes(site)
    }))
    .sort((left, right) => {
      const leftSelected = left.selected ? 0 : 1;
      const rightSelected = right.selected ? 0 : 1;
      return leftSelected - rightSelected || left.label.localeCompare(right.label);
    });
}

function isGatewaySite(site) {
  return ['remoteok', 'remotejobsorg'].includes(site);
}

function defaultSiteLimit(site) {
  return ['remoteok', 'remotive', 'remotejobsorg'].includes(site) ? '20' : '10';
}

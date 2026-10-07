/**
 * Writes clean bruntwork-only preferences for tolu and sister to the Railway volume.
 * Run via: railway run node scripts/ops/write_clean_prefs.cjs
 */
const fs = require('fs');
const path = require('path');

const profilesDir = path.resolve(process.cwd(), 'profiles');

const toluPrefs = {
  displayName: 'Tolu',
  careerBrainPrompt: 'toluCareerBrain.txt',
  enabledSites: ['bruntwork'],
  sitePriority: ['bruntwork'],
  siteLimits: { bruntwork: 200 },
  sites: {
    bruntwork: {
      enabled: true,
      maxJobsPerRun: 200,
      maxAgeDays: 7,
      cooldownMinutes: 3,
      autoApplyEnabled: true,
    },
  },
  allowDuplicateJobs: false,
  remotePreference: 'prefer_remote',
  targetSeniorities: ['entry', 'junior', 'mid'],
  hardFilters: [
    'u.s. work authorization',
    'authorized to work in the united states',
    'security clearance required',
  ],
  exclusions: ['cold calling', 'telemarketing', 'inside sales', 'medical billing', 'paralegal'],
  titleExclusions: [
    'cad designer','drafter','draftsperson','autocad','archicad','millwork',
    'architectural drafter','pharmacist','nurse practitioner','physician','attorney',
    'lawyer','legal advisor','estimator','electrician','plumber','bookkeeper',
    'accountant','administrative assistant','virtual assistant','executive assistant',
    'personal assistant','customer support','customer service','appointment setter',
    'receptionist','data entry',
  ],
  autoApply: true,
  testMode: false,
  maxAutoApplyPerRun: 2,
  autoApplyPerSiteLimit: { bruntwork: 1 },
  maxJobsPerRun: 90,
  minLocalScoreForAi: 75,
  schedulerIntervalMs: 180000,
  aiCacheMaxAgeHours: 72,
  minDelayMs: 800,
  maxDelayMs: 2200,
  userProfileSummary: 'Web developer, SEO specialist, Shopify optimization, JavaScript/Node.js, content systems, YouTube automation experience.',
  applicantEmail: 'toluoyelola066@gmail.com',
};

// Read existing sister prefs to preserve sensitive fields (resume path, applicationDefaults, etc.)
const sisterPrefsPath = path.join(profilesDir, 'sister', 'preferences.json');
let sisterBase = {};
try { sisterBase = JSON.parse(fs.readFileSync(sisterPrefsPath, 'utf8')); } catch { /**/ }

const sisterPrefs = {
  ...sisterBase,
  displayName: 'Sister',
  enabledSites: ['bruntwork'],
  sitePriority: ['bruntwork'],
  siteLimits: { bruntwork: 200 },
  sites: {
    bruntwork: {
      enabled: true,
      maxJobsPerRun: 200,
      maxAgeDays: 7,
      cooldownMinutes: 3,
    },
  },
  autoApplyPerSiteLimit: { bruntwork: 1 },
};
// Remove any non-bruntwork site-level keys
delete sisterPrefs.jobbermanSalaryExpectationNgn;

// Read existing tolu prefs to preserve sensitive fields
const toluPrefsPath = path.join(profilesDir, 'tolu', 'preferences.json');
let toluBase = {};
try { toluBase = JSON.parse(fs.readFileSync(toluPrefsPath, 'utf8')); } catch { /**/ }
const finalToluPrefs = { ...toluBase, ...toluPrefs };

fs.writeFileSync(toluPrefsPath, JSON.stringify(finalToluPrefs, null, 2), 'utf8');
console.log('[prefs] tolu preferences.json updated — enabledSites:', finalToluPrefs.enabledSites);

fs.writeFileSync(sisterPrefsPath, JSON.stringify(sisterPrefs, null, 2), 'utf8');
console.log('[prefs] sister preferences.json updated — enabledSites:', sisterPrefs.enabledSites);

// Also reset siteRunState for both profiles
for (const profile of ['tolu', 'sister']) {
  const stateFile = path.join(profilesDir, profile, 'siteRunState.json');
  fs.writeFileSync(stateFile, JSON.stringify({ sites: {} }, null, 2), 'utf8');
  console.log(`[prefs] ${profile} siteRunState.json reset`);

  const processedFile = path.join(profilesDir, profile, 'processedJobs.json');
  if (fs.existsSync(processedFile)) {
    fs.writeFileSync(processedFile, JSON.stringify([], null, 2), 'utf8');
    console.log(`[prefs] ${profile} processedJobs.json cleared`);
  }
}

console.log('[prefs] Done. Railway will use bruntwork only for both profiles.');

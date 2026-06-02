import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { spawn, execSync } from 'node:child_process';
import http from 'node:http';

import {
  printSuccess, printError, printInfo, printWarn, printStep,
  printHint, printTable, printBox, printSectionHeader, printKeyValue, createSpinner, c
} from './banner.js';
import { ApiError, loadAuth, saveAuth, clearAuth, requireAuth, apiMe, apiLogout } from './auth.js';
import { buildConfig } from '../config.js';
import { startDashboardServer } from '../dashboardServer.js';
import { getUserSupabase } from '../api/db.js';
import { getCachedProfileId } from '../profileSync.js';

const PID_FILE = path.join(process.cwd(), '.jobpilot.pid');
const ROOT     = process.cwd();

// ─────────────────────────────────────────────────────────────────────────────
// Auth — Register
// ─────────────────────────────────────────────────────────────────────────────

export async function cmdRegister() {
  printSectionHeader('Create your account');
  printInfo('Opening browser to the registration page...\n');

  const spin = createSpinner('Starting local auth server').start();

  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      const url  = `http://localhost:3000/register?cli_port=${port}`;

      spin.stop();
      printInfo(`Browser URL: ${c.cyan}${url}${c.reset}`);
      printHint('If your browser did not open, paste the URL above manually.\n');

      try {
        const open = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        const { exec } = await import('node:child_process');
        exec(`${open} "${url}"`, { windowsHide: true });
      } catch { /* user opens it manually */ }

      server.on('request', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

        const parsedUrl = new URL(req.url, `http://127.0.0.1:${port}`);
        if (parsedUrl.pathname === '/callback') {
          const token        = parsedUrl.searchParams.get('token');
          const refreshToken = parsedUrl.searchParams.get('refresh_token');
          const email        = parsedUrl.searchParams.get('email');

          if (token) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            await saveAuth(token, refreshToken, { email });

            console.log();
            printSuccess(`Account created and logged in as ${c.white}${email}${c.reset}`);
            printBox([
              `${c.white}Next step:${c.reset}  Run ${c.cyan}jobpilot init${c.reset}`,
              `            to configure your first profile.`,
            ], { color: c.green, title: 'Welcome to JobPilot!' });
            console.log();
            server.close(() => {
              resolve();
              process.exit(0);
            });
          } else {
            res.writeHead(400); res.end('Missing token');
          }
        } else {
          res.writeHead(404); res.end();
        }
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth — Login
// ─────────────────────────────────────────────────────────────────────────────

export async function cmdLogin() {
  printSectionHeader('Sign in to JobPilot');
  printInfo('Opening browser for secure sign-in...\n');

  const spin = createSpinner('Starting local auth server').start();

  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, '127.0.0.1', async () => {
      const port = server.address().port;
      const url  = `http://localhost:3000/login?cli_port=${port}`;

      spin.stop();
      printInfo(`Browser URL: ${c.cyan}${url}${c.reset}`);
      printHint('If your browser did not open, paste the URL above manually.');
      printHint(`Waiting for sign-in... ${c.gray}(Ctrl+C to cancel)${c.reset}\n`);

      try {
        const open = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        const { exec } = await import('node:child_process');
        exec(`${open} "${url}"`, { windowsHide: true });
      } catch { /* user opens it manually */ }

      server.on('request', async (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

        const parsedUrl = new URL(req.url, `http://127.0.0.1:${port}`);
        if (parsedUrl.pathname === '/callback') {
          const token        = parsedUrl.searchParams.get('token');
          const refreshToken = parsedUrl.searchParams.get('refresh_token');
          const email        = parsedUrl.searchParams.get('email');

          if (token) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
            await saveAuth(token, refreshToken, { email });

            console.log();
            printSuccess(`Signed in as ${c.white}${email}${c.reset}`);
            console.log();
            server.close(() => {
              resolve();
              process.exit(0);
            });
          } else {
            res.writeHead(400); res.end('Missing token');
          }
        } else {
          res.writeHead(404); res.end();
        }
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth — Logout / Whoami
// ─────────────────────────────────────────────────────────────────────────────

export async function cmdLogout() {
  const spin = createSpinner('Signing out...').start();
  await apiLogout();
  spin.succeed('Signed out successfully. See you next time!');
  console.log();
}

export async function cmdWhoami() {
  const auth = await loadAuth();
  if (!auth?.token) {
    printWarn('Not signed in.');
    printHint(`Run: ${c.white}jobpilot login${c.reset}`);
    console.log();
    return;
  }

  const spin = createSpinner('Fetching account info...').start();
  try {
    const me = await apiMe();
    spin.stop();
    console.log();
    printBox([
      `${c.gray}Email   :${c.reset}  ${c.white}${me.email || auth.user?.email || '—'}${c.reset}`,
      `${c.gray}Plan    :${c.reset}  ${c.cyan}${me.plan  || 'free'}${c.reset}`,
      `${c.gray}Saved at:${c.reset}  ${c.gray}${auth.savedAt || '—'}${c.reset}`,
    ], { color: c.blue, title: 'Current User' });
    console.log();
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'network' || err.code === 'timeout')) {
      spin.fail(err.message);
      printHint('Your saved login is still on disk. Try again when the API is reachable.');
    } else if (err instanceof ApiError && err.status === 401) {
      spin.fail('Session expired.');
      printHint(`Run: ${c.white}jobpilot login${c.reset}`);
    } else {
      spin.fail('Could not fetch account info.');
      printHint(err.message || 'Run jobpilot doctor to check your setup.');
    }
    console.log();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Init wizard
// ─────────────────────────────────────────────────────────────────────────────

export async function cmdInit() {
  // Delegate to the clack-based wizard in onboarding.js — single source of truth.
  // Local mode by default (no requireAuth); hosted mode users can still register/login separately.
  const { interactiveInit } = await import('./onboarding.js');
  await interactiveInit();
}

async function _cmdInitLegacy() {
  await requireAuth();

  printSectionHeader('Profile Setup Wizard');
  printInfo(`This wizard will configure a new job-hunting profile.\n`);
  printHint('Press Enter to accept defaults shown in [brackets].\n');

  const rl = createReadline();

  // Step 1 — Profile name
  printStep(1, 8, 'Profile name');
  printHint('e.g. tolu, main, work-hunt  (only letters, numbers, hyphens)');
  const profileNameRaw = (await ask(rl, `  ${c.cyan}›${c.reset} Profile name: `)).trim();
  const profileName    = profileNameRaw.toLowerCase().replace(/[^a-z0-9_-]/g, '_') || 'main';

  // Step 2 — Display name
  printStep(2, 8, 'Your full name');
  const displayName = (await ask(rl, `  ${c.cyan}›${c.reset} Full name: `)).trim();

  // Step 3 — Email
  printStep(3, 8, 'Email for job applications');
  const email = (await ask(rl, `  ${c.cyan}›${c.reset} Email: `)).trim();

  // Step 4 — Role summary
  printStep(4, 8, 'Target role summary');
  printHint('e.g. "Remote customer support, virtual assistant, CRM admin"');
  const summary = (await ask(rl, `  ${c.cyan}›${c.reset} Role summary: `)).trim();

  // Step 5 — Gemini
  printStep(5, 8, 'Gemini API key');
  printHint('Get a free key at: https://aistudio.google.com');
  const geminiKey = (await askHidden(rl, `  ${c.cyan}›${c.reset} GEMINI_API_KEY: `)).trim();

  // Step 6 — CapSolver
  printStep(6, 8, 'CapSolver API key  (paid CAPTCHA solver)');
  printHint('Get your key at: https://www.capsolver.com/  — or press Enter to skip');
  const capsolverKey = (await askHidden(rl, `  ${c.cyan}›${c.reset} CAPSOLVER_API_KEY: `)).trim();

  // Step 7 — Telegram
  printStep(7, 8, 'Telegram Bot  (optional job review notifications)');
  printHint('Press Enter to skip');
  const telegramToken = (await askHidden(rl, `  ${c.cyan}›${c.reset} TELEGRAM_BOT_TOKEN: `)).trim();
  let telegramChatId = '';
  if (telegramToken) {
    telegramChatId = (await ask(rl, `  ${c.cyan}›${c.reset} TELEGRAM_CHAT_ID: `)).trim();
  }

  // Step 8 — Score threshold
  printStep(8, 8, 'Minimum score to auto-apply');
  printHint('0–100, where 100 is a perfect match. Recommended: 70');
  const rawScore = (await ask(rl, `  ${c.cyan}›${c.reset} Min score [70]: `)).trim();
  const minScore = parseInt(rawScore, 10) || 70;

  rl.close();

  // ── Write files ────────────────────────────────────────────────────────────
  console.log();
  const spin = createSpinner('Saving configuration...').start();

  // .env
  const envPath = path.join(ROOT, '.env');
  let envContent = '';
  try { envContent = await fs.readFile(envPath, 'utf-8'); } catch { /* new */ }

  const envLines = [
    geminiKey      ? `GEMINI_API_KEY=${geminiKey}` : '',
    capsolverKey ? `CAPSOLVER_API_KEY=${capsolverKey}` : '',
    telegramToken  ? `TELEGRAM_BOT_TOKEN=${telegramToken}` : '',
    (telegramToken && telegramChatId) ? `TELEGRAM_CHAT_ID=${telegramChatId}` : '',
  ].filter(Boolean);

  for (const line of envLines) {
    const key = line.split('=')[0];
    const re  = new RegExp(`^${key}=.*`, 'm');
    if (re.test(envContent)) {
      envContent = envContent.replace(re, line); // update existing
    } else {
      envContent += `\n${line}`;
    }
  }
  await fs.writeFile(envPath, envContent.trim() + '\n', 'utf-8');

  // profile dir
  const profileDir = path.join(ROOT, 'profiles', profileName);
  await fs.mkdir(profileDir, { recursive: true });

  const prefs = {
    displayName,
    enabledSites: ['bruntwork','remoteok','remotive'],
    sitePriority: ['bruntwork','remoteok','remotive'],
    siteLimits:   { bruntwork:10, remoteok:10, remotive:10 },
    allowDuplicateJobs: false,
    remotePreference: 'prefer_remote',
    targetSeniorities: ['entry','junior','mid'],
    hardFilters: ['u.s. work authorization','security clearance required'],
    exclusions: ['cold calling','telemarketing'],
    titleExclusions: ['pharmacist','physician','attorney'],
    autoApply: true,
    testMode: false,
    maxAutoApplyPerRun: 5,
    maxJobsPerRun: 20,
    minLocalScoreForAi: minScore,
    applicantEmail: email,
    userProfileSummary: summary
  };

  await fs.writeFile(path.join(profileDir, 'preferences.json'), JSON.stringify(prefs, null, 2), 'utf-8');
  await fs.writeFile(
    path.join(profileDir, 'PLACE_RESUME_HERE.txt'),
    'Place your resume PDF in this folder, then update resumePath in preferences.json\n',
    'utf-8'
  );

  spin.succeed('Profile saved!');
  console.log();
  printBox([
    `${c.green}✓${c.reset} Profile     : ${c.white}${profileName}${c.reset}  →  profiles/${profileName}/`,
    `${c.green}✓${c.reset} .env updated : ${envLines.length} key(s) written`,
    '',
    `${c.white}Next steps:${c.reset}`,
    `  1. Copy your resume PDF into ${c.cyan}profiles/${profileName}/${c.reset}`,
    `  2. Update ${c.cyan}resumePath${c.reset} in preferences.json`,
    `  3. Run: ${c.cyan}jobpilot start --profile=${profileName}${c.reset}`,
  ], { color: c.green, title: 'Setup Complete' });
  console.log();
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings & Email
// ─────────────────────────────────────────────────────────────────────────────

export async function cmdSettings(args) {
  const profile = args.profile || args.p || await guessDefaultProfile();
  const profileDir = path.join(ROOT, 'profiles', profile);
  const prefsPath = path.join(profileDir, 'preferences.json');

  let prefs = {};
  try {
    prefs = JSON.parse(await fs.readFile(prefsPath, 'utf-8'));
  } catch {
    printError(`Profile "${profile}" not found. Run jobpilot init first.`);
    return;
  }

  printSectionHeader(`Settings  ·  ${profile}`);

  const currentScore  = prefs.minLocalScoreForAi ?? 70;
  const currentApply  = prefs.autoApply !== false;
  const currentMax    = prefs.maxAutoApplyPerRun ?? 5;
  const currentJobs   = prefs.maxJobsPerRun ?? 20;
  const currentSites  = (prefs.enabledSites || []).join(',');

  printInfo(`Current settings for ${c.white}${profile}${c.reset}:`);
  printKeyValue('Auto-apply', currentApply ? `${c.green}on${c.reset}` : `${c.red}off${c.reset}`);
  printKeyValue('Min score', `${currentScore}`);
  printKeyValue('Max applies/run', `${currentMax}`);
  printKeyValue('Max jobs/run', `${currentJobs}`);
  printKeyValue('Sites enabled', currentSites || '(all defaults)');
  console.log();

  const rl = createReadline();

  printStep(1, 6, 'Auto-apply');
  const rawApply = (await ask(rl, `  ${c.cyan}›${c.reset} Enable auto-apply? (y/n) [${currentApply ? 'y' : 'n'}]: `)).trim().toLowerCase();
  if (rawApply === 'y' || rawApply === 'n') prefs.autoApply = rawApply === 'y';

  printStep(2, 6, 'Minimum AI match score to auto-apply (0–100)');
  const rawScore = (await ask(rl, `  ${c.cyan}›${c.reset} Min score [${currentScore}]: `)).trim();
  if (rawScore) { const n = parseInt(rawScore, 10); if (!isNaN(n) && n >= 0 && n <= 100) prefs.minLocalScoreForAi = n; }

  printStep(3, 6, 'Max applications per run');
  const rawMax = (await ask(rl, `  ${c.cyan}›${c.reset} Max applies/run [${currentMax}]: `)).trim();
  if (rawMax) { const n = parseInt(rawMax, 10); if (!isNaN(n) && n > 0) prefs.maxAutoApplyPerRun = n; }

  printStep(4, 6, 'Max jobs to scrape per run');
  const rawJobs = (await ask(rl, `  ${c.cyan}›${c.reset} Max jobs/run [${currentJobs}]: `)).trim();
  if (rawJobs) { const n = parseInt(rawJobs, 10); if (!isNaN(n) && n > 0) prefs.maxJobsPerRun = n; }

  printStep(5, 6, 'Peak-hour timing (optional)');
  const enablePeak = (await ask(rl, `  ${c.cyan}›${c.reset} Restrict to peak hours? (y/n) [${prefs.peakHoursEnabled ? 'y' : 'n'}]: `)).trim().toLowerCase();
  if (enablePeak === 'y' || enablePeak === 'n') prefs.peakHoursEnabled = enablePeak === 'y';

  if (prefs.peakHoursEnabled) {
    printStep(6, 6, 'Peak window (HH:MM–HH:MM, days 1=Mon…7=Sun)');
    const start = (await ask(rl, `  ${c.cyan}›${c.reset} Start [${prefs.peakHoursStart || '08:00'}]: `)).trim();
    if (start) prefs.peakHoursStart = start;
    const end   = (await ask(rl, `  ${c.cyan}›${c.reset} End   [${prefs.peakHoursEnd || '18:00'}]: `)).trim();
    if (end)   prefs.peakHoursEnd = end;
    const days  = (await ask(rl, `  ${c.cyan}›${c.reset} Days  [${(prefs.peakDays || ['1','2','3','4','5']).join(',')}]: `)).trim();
    if (days)  prefs.peakDays = days.split(',').map(d => d.trim());
  }

  rl.close();

  await fs.writeFile(prefsPath, JSON.stringify(prefs, null, 2), 'utf-8');
  console.log();
  printSuccess(`Settings saved for "${profile}". Restart the scheduler to apply.`);
  printHint('jobpilot restart');
  console.log();
}

export async function cmdProfiles(args) {
  const profilesDir = path.join(ROOT, 'profiles');
  let names = [];
  try {
    names = (await fs.readdir(profilesDir)).filter(p => !p.startsWith('.') && p !== 'example');
  } catch {
    printWarn('No profiles directory found.');
    printHint('Run: jobpilot init');
    return;
  }

  if (names.length === 0) {
    printWarn('No profiles configured yet.');
    printHint('Run: jobpilot init');
    return;
  }

  printSectionHeader('Profiles');

  const rows = [];
  for (const name of names) {
    const prefsPath = path.join(profilesDir, name, 'preferences.json');
    const storePath = path.join(profilesDir, name, 'processedJobs.json');
    let displayName = name;
    let email = '—';
    let applied = '—';
    let score = '—';
    let autoApply = '—';
    try {
      const prefs = JSON.parse(await fs.readFile(prefsPath, 'utf-8'));
      displayName = prefs.displayName || name;
      email       = prefs.applicantEmail || '—';
      score       = String(prefs.minLocalScoreForAi ?? '—');
      autoApply   = prefs.autoApply !== false ? `${c.green}on${c.reset}` : `${c.red}off${c.reset}`;
    } catch { /* prefs missing */ }
    try {
      const store = JSON.parse(await fs.readFile(storePath, 'utf-8'));
      applied = String((store.jobs || []).filter(j => j.status === 'applied').length);
    } catch { /* no run data */ }
    rows.push([`${c.white}${name}${c.reset}`, displayName, email, `${c.green}${applied}${c.reset}`, score, autoApply]);
  }

  printTable(rows, ['Profile', 'Name', 'Email', 'Applied', 'Score', 'Auto-apply']);
  console.log();
  printHint('Edit a profile:  jobpilot settings --profile=<name>');
  console.log();
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue — show jobs awaiting dashboard decision or staged for apply
// ─────────────────────────────────────────────────────────────────────────────
export async function cmdQueue(args) {
  const auth = await requireAuth();
  if (!auth) return;

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    printError('Supabase not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env');
    return;
  }

  const QUEUE_STATUSES = ['reviewed', 'pending_apply', 'approved'];
  const limit = Math.min(parseInt(args.limit, 10) || 50, 200);

  const spin = createSpinner('Fetching queue from Supabase...').start();

  let jobs = [];
  try {
    const supabase = getUserSupabase(auth.token);
    let query = supabase
      .from('job_applications')
      .select('title, company, score, status, job_url, updated_at, profile_id')
      .in('status', QUEUE_STATUSES)
      .order('score', { ascending: false })
      .limit(limit);

    if (args.profile) {
      const profileId = getCachedProfileId(auth.user?.id, args.profile);
      if (profileId) {
        query = query.eq('profile_id', profileId);
      } else {
        // Fall back to a live lookup so this works even on first run
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('profile_name', args.profile)
          .single();
        if (profile?.id) query = query.eq('profile_id', profile.id);
        else {
          spin.stop();
          printWarn(`No profile named "${args.profile}" in Supabase.`);
          return;
        }
      }
    }

    const { data, error } = await query;
    if (error) {
      spin.fail('Fetch failed');
      printError(error.message);
      return;
    }
    jobs = data || [];
  } catch (err) {
    spin.fail('Fetch failed');
    printError(err.message);
    return;
  }

  spin.stop();

  printSectionHeader(`Queue${args.profile ? ` · ${args.profile}` : ''}`);

  if (jobs.length === 0) {
    printInfo('No jobs awaiting review or staged for apply.');
    console.log();
    return;
  }

  const colorStatus = (s) =>
    s === 'approved'      ? `${c.green}${s}${c.reset}` :
    s === 'pending_apply' ? `${c.cyan}${s}${c.reset}`  :
    s === 'reviewed'      ? `${c.yellow}${s}${c.reset}`:
                            s;

  const trim = (s, n) => {
    const t = String(s ?? '');
    return t.length > n ? t.slice(0, n - 1) + '…' : t;
  };

  const rows = jobs.map((j) => [
    trim(j.title, 36),
    trim(j.company, 22),
    `${c.white}${j.score ?? 0}${c.reset}`,
    colorStatus(j.status),
    j.updated_at ? new Date(j.updated_at).toLocaleDateString() : '—'
  ]);

  printTable(rows, ['Title', 'Company', 'Score', 'Status', 'Updated']);

  const counts = jobs.reduce((acc, j) => { acc[j.status] = (acc[j.status] || 0) + 1; return acc; }, {});
  console.log();
  printInfo(`Totals: ${Object.entries(counts).map(([s, n]) => `${s}=${n}`).join('  ')}`);
  printHint('Approve or reject jobs:  jobpilot dashboard');
  console.log();
}

export async function cmdSetupEmail() {
  printSectionHeader('Email Tracking Setup');
  printInfo('To track application responses, JobPilot needs IMAP access to your inbox.');
  printInfo('For Gmail, you must generate an App Password.');
  console.log();
  
  const rl = createReadline();
  const email = (await ask(rl, `  ${c.cyan}›${c.reset} Applicant Email: `)).trim();
  const password = (await askHidden(rl, `  ${c.cyan}›${c.reset} IMAP App Password: `)).trim();
  const imapHost = (await ask(rl, `  ${c.cyan}›${c.reset} IMAP Host [imap.gmail.com]: `)).trim() || 'imap.gmail.com';
  rl.close();

  const envPath = path.join(ROOT, '.env');
  let envContent = '';
  try { envContent = await fs.readFile(envPath, 'utf-8'); } catch { /* new */ }

  const newLines = [
    `IMAP_USER=${email}`,
    `IMAP_PASSWORD=${password}`,
    `IMAP_HOST=${imapHost}`,
    `IMAP_PORT=993`
  ];

  for (const line of newLines) {
    const key = line.split('=')[0];
    const re  = new RegExp(`^${key}=.*`, 'm');
    if (re.test(envContent)) {
      envContent = envContent.replace(re, line);
    } else {
      envContent += `\n${line}`;
    }
  }

  await fs.writeFile(envPath, envContent.trim() + '\n', 'utf-8');
  printSuccess('Email configuration saved to .env');
  console.log();
}

// ─────────────────────────────────────────────────────────────────────────────
// Scheduler commands
// ─────────────────────────────────────────────────────────────────────────────

export async function cmdStart(args) {
  const profile = args.profile || args.p || null;
  const env = { ...process.env };
  if (profile) {
    env.PROFILE = profile;
    env.JOBPILOT_PROFILE = profile;
  }

  const label = profile ? `profile ${c.white}${profile}${c.reset}` : 'all profiles';
  printInfo(`Starting scheduler via PM2 (${label})...`);
  try {
    // On Windows, use CREATE_NO_WINDOW flag to prevent console windows
    const spawnOptions = {
      stdio: 'ignore',
      cwd: ROOT,
      env,
      detached: false,
      windowsHide: true
    };

    if (process.platform === 'win32') {
      spawnOptions.windowsVerbatimArguments = true;
    }

    execSync('npx pm2 start ecosystem.config.cjs --update-env', spawnOptions);
    printSuccess(`Scheduler started`);
    console.log();
    printKeyValue('Logs', 'jobpilot logs', { color: c.cyan });
    printKeyValue('Dashboard', 'jobpilot dashboard', { color: c.cyan });
    printKeyValue('Stop', 'jobpilot stop', { color: c.cyan });
  } catch (err) {
    printError('Failed to start scheduler via PM2.');
    printError(err.message);
  }
  console.log();
}

export async function cmdStop() {
  const spin = createSpinner('Stopping scheduler...').start();
  try {
    execSync('npx pm2 stop jobpilot-scheduler', { stdio: 'ignore', cwd: ROOT, windowsHide: true });
    spin.succeed('Scheduler stopped.');
  } catch {
    spin.stop();
    printWarn('Scheduler was not running.');
  }
  console.log();
}

export async function cmdRestart(args) {
  const spin = createSpinner('Restarting scheduler...').start();
  try {
    execSync('npx pm2 restart jobpilot-scheduler', { stdio: 'ignore', cwd: ROOT, windowsHide: true });
    spin.succeed('Scheduler restarted.');
    printHint('Use jobpilot logs to stream live output.');
  } catch {
    spin.stop();
    printWarn('Scheduler was not running. Use jobpilot start to launch it.');
  }
  console.log();
}

export async function cmdStatus(args) {
  const profilesDir = path.join(ROOT, 'profiles');
  const targetProfile = args.profile || args.p || null;
  let profiles = [];
  try {
    if (targetProfile) {
      await fs.access(path.join(profilesDir, targetProfile));
      profiles = [targetProfile];
    } else {
      profiles = await fs.readdir(profilesDir);
      profiles = profiles.filter(p => !p.startsWith('.') && p !== 'example');
    }
  } catch {
    if (targetProfile) {
      printWarn(`Profile not found: ${targetProfile}`);
      printHint(`Run: ${c.white}jobpilot profiles${c.reset} to list configured profiles.`);
      process.exitCode = 1;
    } else {
      printWarn('No profiles found.');
      printHint(`Run: ${c.white}jobpilot init${c.reset}`);
      process.exitCode = 1;
    }
    console.log();
    return;
  }

  // Scheduler status via PM2
  let schedulerRunning = false;
  let pm2Status = '';
  try {
    const output = execSync('npx pm2 jlist', { encoding: 'utf-8', cwd: ROOT, timeout: 5000, windowsHide: true });
    const pm2List = JSON.parse(output);
    const app = pm2List.find(p => p.name === 'jobpilot-scheduler');
    if (app && app.pm2_env.status === 'online') {
      schedulerRunning = true;
      pm2Status = `PID ${app.pid}`;
    }
  } catch { /* not running */ }

  // Build table rows
  const rows = [];
  for (const p of profiles) {
    const storePath = path.join(profilesDir, p, 'processedJobs.json');
    try {
      const store   = JSON.parse(await fs.readFile(storePath, 'utf-8'));
      const jobs    = store.jobs || [];
      const applied = jobs.filter(j => j.status === 'applied').length;
      const pending = jobs.filter(j => j.status === 'reviewed' || j.status === 'pending_apply').length;
      const failed  = jobs.filter(j => j.status === 'failed').length;
      const cutoff  = Date.now() - 86400000;
      const today   = jobs.filter(j => j.status === 'applied' && j.updatedAt && new Date(j.updatedAt) > cutoff).length;
      rows.push([
        `${c.white}${p}${c.reset}`,
        jobs.length,
        `${c.green}${applied}${c.reset}`,
        `${c.yellow}${pending}${c.reset}`,
        `${c.red}${failed}${c.reset}`,
        `${c.cyan}${today}${c.reset}`,
      ]);
    } catch {
      rows.push([`${c.white}${p}${c.reset}`, '–', '–', '–', '–', '–']);
    }
  }

  const cols = process.stdout.columns || 80;
  console.log();
  if (cols < 80) {
    for (const row of rows) {
      printBox([
        `Profile: ${row[0]}`,
        `Total:   ${row[1]}`,
        `Applied: ${row[2]}`,
        `Pending: ${row[3]}`,
        `Failed:  ${row[4]}`,
        `Today:   ${row[5]}`
      ], { color: c.gray, title: 'Status' });
    }
  } else {
    printTable(rows, ['Profile', 'Total', 'Applied', 'Pending', 'Failed', 'Today']);
  }
  console.log();

  if (schedulerRunning) {
    printSuccess(`Scheduler is ${c.green}RUNNING${c.reset}  ${c.gray}(${pm2Status})${c.reset}`);
  } else {
    printWarn(`Scheduler is ${c.red}STOPPED${c.reset}`);
    printHint(`Run: ${c.white}jobpilot start${c.reset}`);
  }
  console.log();
}

export async function cmdLogs(args) {
  const lines = String(args.lines || args.n || 50);
  const profile = args.profile || args.p || null;
  const appName = 'jobpilot-scheduler';

  printSectionHeader(`Live Log${profile ? `  ·  ${profile}` : ''}`);
  printHint('Press Ctrl+C to stop');
  console.log();

  try {
    const cmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    spawn(cmd, ['pm2', 'logs', appName, '--lines', lines], {
      stdio: 'inherit',
      cwd: ROOT,
      shell: process.platform === 'win32'
    });
  } catch (err) {
    printError(`Could not fetch logs: ${err.message}`);
  }

  process.on('SIGINT', () => { console.log(); process.exit(0); });
  await new Promise(() => {}); // keep alive
}

export async function cmdDashboard() {
  const port = Number.parseInt(process.env.DASHBOARD_PORT || '3000', 10);
  const url = `http://localhost:${port}/`;
  printWarn('The local web dashboard is a dev/debug tool. For normal use, run jobpilot dashboard for the terminal dashboard or use the hosted dashboard sync.');
  const spin = createSpinner('Opening local dev web dashboard...').start();
  try {
    const online = await isLocalDashboardOnline(port);
    if (!online) {
      const configs = await buildDashboardConfigs();
      startDashboardServer(configs, port);
      await waitForLocalDashboard(port);
    }

    const open = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const { exec } = await import('node:child_process');
    exec(`${open} "${url}"`, { windowsHide: true });
    spin.succeed(`Local dev web dashboard opened at ${url}`);
    printHint('Keep this terminal open if the scheduler is not already running.');
  } catch (err) {
    spin.stop();
    printWarn(`Could not open the local dashboard automatically: ${err.message}`);
    printInfo(`Navigate to: ${c.cyan}${url}${c.reset}`);
  }
  console.log();
}

async function buildDashboardConfigs() {
  let profiles = [];
  try {
    profiles = (await fs.readdir(path.join(ROOT, 'profiles'))).filter(p => !p.startsWith('.') && p !== 'example');
  } catch {
    profiles = ['main'];
  }
  return profiles.map((profile) => buildConfig([process.argv[0] || 'node', process.argv[1] || 'jobpilot', `--profile=${profile}`]));
}

async function isLocalDashboardOnline(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/stats`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForLocalDashboard(port) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (await isLocalDashboardOnline(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`dashboard did not start on port ${port}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Input helpers
// ─────────────────────────────────────────────────────────────────────────────

function createReadline() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

function askHidden(rl, prompt) {
  return new Promise(resolve => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    stdin.setRawMode?.(true);
    let input = '';
    const onData = (buf) => {
      const char = buf.toString();
      if (char === '\r' || char === '\n') {
        stdin.setRawMode?.(false);
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(input);
      } else if (char === '\u0003') {
        process.exit();
      } else if (char === '\u007f') {
        if (input.length > 0) { input = input.slice(0, -1); process.stdout.write('\b \b'); }
      } else {
        input += char;
        process.stdout.write('·'); // use bullet instead of * for a cleaner look
      }
    };
    stdin.on('data', onData);
    stdin.resume();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Log colouriser
// ─────────────────────────────────────────────────────────────────────────────

function printLogLine(line) {
  if (!line.trim()) return;
  const l = line.trim();
  if      (/APPLIED|✓/i.test(l))                  console.log(`  ${c.green}${l}${c.reset}`);
  else if (/FAILED|ERROR|✗/i.test(l))             console.log(`  ${c.red}${l}${c.reset}`);
  else if (/REVIEW|QUEUED|pending/i.test(l))       console.log(`  ${c.yellow}${l}${c.reset}`);
  else if (/Run started|Run finished|STARTING/i.test(l)) console.log(`  ${c.blue}${c.bold}${l}${c.reset}`);
  else if (/SKIPPED|IGNORED|dedup/i.test(l))       console.log(`  ${c.gray}${l}${c.reset}`);
  else                                              console.log(`  ${c.gray}${l}${c.reset}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Misc helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function guessDefaultProfile() {
  try {
    const profiles = (await fs.readdir(path.join(ROOT, 'profiles'))).filter(p => !p.startsWith('.') && p !== 'example');
    return profiles[0] || 'main';
  } catch { return 'main'; }
}

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { spawn, execSync } from 'node:child_process';

import {
  printSuccess, printError, printInfo, printWarn, printStep,
  printHint, printTable, printBox, printSectionHeader, printKeyValue, createSpinner, c
} from './banner.js';
import { buildConfig } from '../config.js';
import { startDashboardServer } from '../dashboardServer.js';

const PID_FILE = path.join(process.cwd(), '.jobpilot.pid');
const ROOT     = process.cwd();

// ─────────────────────────────────────────────────────────────────────────────
// Init wizard
// ─────────────────────────────────────────────────────────────────────────────

export async function cmdInit() {
  // Delegate to the clack-based wizard in onboarding.js — single source of truth.
  const { interactiveInit } = await import('./onboarding.js');
  await interactiveInit();
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

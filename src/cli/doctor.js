import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { resolveStoredProfilePath } from '../config.js';
import { listProfiles } from '../dataStore.js';
import { readResumeText } from '../profileParser.js';
import { printBox, printHint, printInfo, printSectionHeader, printSuccess, printTable, printWarn, c } from './banner.js';

export async function cmdDoctor(args = {}) {
  const rootDir = process.cwd();
  const profileName = args.profile || args.p || null;
  const report = await inspectHealth({
    rootDir,
    profileName,
    env: process.env,
    readResumeTextImpl: readResumeText,
    schedulerStatusImpl: inspectSchedulerStatus
  });

  console.log();
  printSectionHeader(profileName ? `JobPilot Doctor  ·  ${profileName}` : 'JobPilot Doctor');

  const issueCount = report.summary.issueCount;
  printBox([
    `${c.gray}Profiles checked:${c.reset}  ${c.white}${report.profiles.length}${c.reset}`,
    `${c.gray}Issues found:   ${c.reset}  ${issueCount > 0 ? c.yellow + issueCount + c.reset : c.green + '0' + c.reset}`,
    `${c.gray}Scheduler:     ${c.reset}  ${statusLabel(report.scheduler.status)}`,
    `${c.gray}Environment:   ${c.reset}  ${statusLabel(report.environment.status)}`,
  ], { color: issueCount > 0 ? c.yellow : c.green, title: 'Health Summary' });

  console.log();
  renderChecks('Environment', report.environment.checks);
  renderScheduler(report.scheduler);

  for (const profile of report.profiles) {
    renderProfile(profile);
  }

  if (issueCount === 0) {
    printSuccess('No blocking issues found.');
  } else {
    printWarn('Review the warnings above before starting the scheduler or enabling auto-apply.');
    printHint(`If you want a quick follow-up, run ${c.white}jobpilot status${c.reset} or ${c.white}jobpilot logs${c.reset}.`);
  }
  console.log();
}

export async function inspectHealth({
  rootDir = process.cwd(),
  profileName = null,
  env = process.env,
  readResumeTextImpl = readResumeText,
  schedulerStatusImpl = inspectSchedulerStatus
} = {}) {
  const profileNames = profileName ? [profileName] : await listProfiles(rootDir);
  const profiles = await Promise.all(profileNames.map((name) =>
    inspectProfile(rootDir, name, { readResumeTextImpl, env })
  ));

  const environment = inspectEnvironment(env);
  const scheduler = await schedulerStatusImpl(rootDir);
  const summary = summarizeReports({ profiles, environment, scheduler });

  return {
    rootDir,
    profiles,
    environment,
    scheduler,
    summary
  };
}

export async function inspectProfile(rootDir, profileName, {
  readResumeTextImpl = readResumeText,
  env = process.env
} = {}) {
  const profileDir = path.join(rootDir, 'profiles', profileName);
  const prefsPath = path.join(profileDir, 'preferences.json');
  const candidatePath = path.join(profileDir, 'candidateProfile.json');
  const jobsPath = path.join(profileDir, 'processedJobs.json');
  const reviewPath = path.join(profileDir, 'reviewQueue.json');
  const prefs = await readJson(prefsPath, null);
  const profileExists = await exists(profileDir);
  const storedResume = resolveStoredProfilePath(rootDir, profileDir, prefs?.resumePath || 'resume.pdf');
  const resumePath = storedResume.absolutePath;
  const checks = [];

  checks.push(profileExists
    ? pass('Profile folder', `Found ${path.relative(rootDir, profileDir)}`)
    : fail('Profile folder', `Missing ${path.relative(rootDir, profileDir)}`));

  checks.push(prefs
    ? pass('Preferences', `Loaded ${path.relative(rootDir, prefsPath)}`)
    : fail('Preferences', `Missing or unreadable ${path.relative(rootDir, prefsPath)}`));

  checks.push(await fileCheck(candidatePath, 'Candidate profile', rootDir, false));
  checks.push(await fileCheck(jobsPath, 'Processed jobs', rootDir, false));
  checks.push(await fileCheck(reviewPath, 'Review queue', rootDir, false));

  if (prefs?.resumePlaceholder) {
    checks.push(warn('Resume', `Profile is using a placeholder resume. Set resumePath before auto-apply.`));
  } else {
    if (!storedResume.isPortable) {
      checks.push(warn('Resume path', `Uses machine-specific absolute path: ${storedResume.rawValue}`));
    }
    const resumeExists = await exists(resumePath);
    if (!resumeExists) {
      checks.push(fail('Resume', `Missing ${path.relative(rootDir, resumePath)}`));
    } else {
      const text = await readResumeTextImpl(resumePath).catch(() => '');
      if (text.length > 0) {
        checks.push(pass('Resume', `Parsed ${text.length} characters from ${path.relative(rootDir, resumePath)}`));
      } else {
        checks.push(warn('Resume', `File exists but yielded no text: ${path.relative(rootDir, resumePath)}`));
      }
    }
  }

  const applicantEmail = prefs?.applicantEmail || env.APPLICANT_EMAIL || '';
  checks.push(applicantEmail
    ? pass('Applicant email', applicantEmail)
    : warn('Applicant email', 'Not configured'));

  const enabledSites = Array.isArray(prefs?.enabledSites) ? prefs.enabledSites.length : 0;
  checks.push(enabledSites > 0
    ? pass('Enabled sites', `${enabledSites} configured`)
    : warn('Enabled sites', 'No sites enabled in preferences'));

  const summary = summarizeChecks(checks);

  return {
    profileName,
    profileDir,
    displayName: prefs?.displayName || profileName,
    checks,
    status: summary.status,
    summary
  };
}

export function inspectEnvironment(env = process.env) {
  const checks = [];

  checks.push(env.GEMINI_API_KEY
    ? pass('GEMINI_API_KEY', 'Configured')
    : warn('GEMINI_API_KEY', 'Missing - AI resume and job analysis will be limited'));

  checks.push(env.APPLICANT_EMAIL
    ? pass('APPLICANT_EMAIL', env.APPLICANT_EMAIL)
    : warn('APPLICANT_EMAIL', 'Missing - profile setup may be incomplete'));

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    checks.push(pass('Telegram', 'Token and chat ID configured'));
  } else if (env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_CHAT_ID) {
    checks.push(warn('Telegram', 'Partially configured - check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID'));
  } else {
    checks.push(info('Telegram', 'Not configured - notifications disabled'));
  }

  if (env.CAPTCHASOLV_API_KEY || env.CAPSOLVER_API_KEY) {
    checks.push(pass('CAPTCHA solver', 'Configured'));
  } else {
    checks.push(info('CAPTCHA solver', 'Not configured - CAPTCHA forms require manual review; headless runs skip them'));
  }

  if (env.ALLOW_GATEWAY_AUTO_SUBMIT === 'true') {
    checks.push(pass('Gateway handoff', 'Enabled for audited apply adapters'));
  } else {
    checks.push(info('Gateway handoff', 'Off - source-board redirects route to review unless enabled per profile'));
  }

  const summary = summarizeChecks(checks);
  return {
    status: summary.status,
    summary,
    checks
  };
}

export async function inspectSchedulerStatus(rootDir = process.cwd()) {
  try {
    const output = execSync('npx pm2 jlist', {
      encoding: 'utf8',
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      windowsHide: true
    });
    const apps = JSON.parse(output);
    const scheduler = apps.find((app) => app.name === 'jobpilot-scheduler');
    if (scheduler && scheduler.pm2_env?.status === 'online') {
      return {
        status: 'pass',
        label: 'Scheduler',
        detail: `Running via PM2 (PID ${scheduler.pid || 'unknown'})`
      };
    }
    return {
      status: 'warn',
      label: 'Scheduler',
      detail: 'PM2 is available but jobpilot-scheduler is not online'
    };
  } catch {
    return {
      status: 'warn',
      label: 'Scheduler',
      detail: 'PM2 is not reachable or scheduler is not running'
    };
  }
}

async function fileCheck(filePath, label, rootDir, required = false) {
  const present = await exists(filePath);
  if (present) {
    return pass(label, `Found ${path.relative(rootDir, filePath)}`);
  }
  return required
    ? fail(label, `Missing ${path.relative(rootDir, filePath)}`)
    : info(label, `Not found: ${path.relative(rootDir, filePath)}`);
}

function renderChecks(title, report) {
  const checks = Array.isArray(report) ? report : [];
  if (checks.length === 0) return;
  printSectionHeader(title);
  printTable(
    checks.map((check) => [
      statusLabel(check.status),
      check.label,
      check.detail
    ]),
    ['Status', 'Check', 'Detail']
  );
  console.log();
}

function renderScheduler(scheduler) {
  printSectionHeader('Scheduler');
  printBox([
    `${c.gray}Status:${c.reset}  ${statusLabel(scheduler.status)}`,
    `${c.gray}Detail:${c.reset}  ${scheduler.detail}`
  ], { color: scheduler.status === 'pass' ? c.green : c.yellow, title: 'Scheduler Health' });
  console.log();
}

function renderProfile(profile) {
  printSectionHeader(`Profile  ·  ${profile.profileName}`);
  printBox([
    `${c.gray}Display name:${c.reset}  ${c.white}${profile.displayName || profile.profileName}${c.reset}`,
    `${c.gray}Status:${c.reset}        ${statusLabel(profile.status)}`
  ], { color: profile.status === 'pass' ? c.green : c.yellow, title: 'Profile Health' });

  const rows = profile.checks.map((check) => [
    statusLabel(check.status),
    check.label,
    check.detail
  ]);
  printTable(rows, ['Status', 'Check', 'Detail']);
  console.log();
}

function statusLabel(status) {
  if (status === 'pass') return `${c.green}PASS${c.reset}`;
  if (status === 'warn') return `${c.yellow}WARN${c.reset}`;
  if (status === 'fail') return `${c.red}FAIL${c.reset}`;
  return `${c.cyan}INFO${c.reset}`;
}

function pass(label, detail) {
  return { status: 'pass', label, detail };
}

function warn(label, detail) {
  return { status: 'warn', label, detail };
}

function fail(label, detail) {
  return { status: 'fail', label, detail };
}

function info(label, detail) {
  return { status: 'info', label, detail };
}

function summarizeReports({ profiles, environment, scheduler }) {
  const checks = [...environment.checks, scheduler, ...profiles.flatMap((profile) => profile.checks)];
  return summarizeChecks(checks);
}

function summarizeChecks(checks) {
  const list = Array.isArray(checks) ? checks : [];
  const fail = list.filter((check) => check.status === 'fail').length;
  const warn = list.filter((check) => check.status === 'warn').length;
  const pass = list.filter((check) => check.status === 'pass').length;
  const info = list.filter((check) => check.status === 'info').length;
  const status = fail > 0 ? 'fail' : warn > 0 ? 'warn' : 'pass';
  return {
    status,
    fail,
    warn,
    pass,
    info,
    total: list.length,
    issueCount: fail + warn
  };
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

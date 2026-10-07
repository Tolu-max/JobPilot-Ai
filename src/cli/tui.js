import readline from 'node:readline';
import { execSync } from 'node:child_process';
import pc from 'picocolors';
import { getSystemSnapshot } from '../dataStore.js';
import { cmdStart, cmdStatus } from './commands.js';
import { cmdDashboard as cmdTerminalDashboard } from './dashboard.js';
import { cmdDoctor } from './doctor.js';
import { interactiveInit } from './onboarding.js';
import { interactiveChat } from './chat.js';

const ROOT = process.cwd();

const ACTIONS = [
  { id: 'start', label: 'Start job hunt', hint: 'Run all configured profiles through the scheduler' },
  { id: 'applications', label: 'View applications', hint: 'Show profile pipeline status' },
  { id: 'cv', label: 'Review CV intelligence', hint: 'Open guided profile and resume setup' },
  { id: 'doctor', label: 'Run health check', hint: 'Inspect profiles, resume parsing, and scheduler status' },
  { id: 'chat', label: 'AI Assistant', hint: 'Ask about matches, CV improvements, and failures' },
  { id: 'dashboard', label: 'Open terminal dashboard', hint: 'Open local auto-refreshing view' },
  { id: 'exit', label: 'Exit', hint: 'Close JobPilot' }
];

export async function cmdTui(args = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    await cmdStatus(args);
    return;
  }

  let selected = 0;
  let active = true;
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  enterAlternateScreen();
  hideCursor();

  const render = async () => {
    const snapshot = await getSystemSnapshot(ROOT);
    const schedulerRunning = isSchedulerRunning();
    clearScreen();
    drawDashboard(snapshot, schedulerRunning, selected);
  };

  await render();

  return new Promise((resolve) => {
    const onKeypress = async (_str, key = {}) => {
      if (!active) return;
      if (key.ctrl && key.name === 'c') {
        cleanup();
        resolve();
        return;
      }

      if (key.name === 'up') {
        selected = selected === 0 ? ACTIONS.length - 1 : selected - 1;
        await render();
        return;
      }

      if (key.name === 'down') {
        selected = selected === ACTIONS.length - 1 ? 0 : selected + 1;
        await render();
        return;
      }

      if (key.name === 'return') {
        const action = ACTIONS[selected];
        active = false;
        cleanup(false);
        await runAction(action.id, args);
        if (action.id === 'exit') {
          cleanup();
          resolve();
          return;
        }
        await waitForEnter();
        active = true;
        process.stdin.setRawMode(true);
        hideCursor();
        process.stdin.on('keypress', onKeypress);
        await render();
      }
    };

    function cleanup(final = true) {
      process.stdin.off('keypress', onKeypress);
      process.stdin.setRawMode(false);
      showCursor();
      if (final) exitAlternateScreen();
      if (final) console.log();
    }

    process.stdin.on('keypress', onKeypress);
  });
}

async function runAction(actionId, args) {
  clearScreen();
  if (actionId === 'start') return cmdStart(args);
  if (actionId === 'applications') return cmdStatus(args);
  if (actionId === 'cv') return interactiveInit(args);
  if (actionId === 'doctor') return cmdDoctor(args);
  if (actionId === 'chat') return interactiveChat(args);
  if (actionId === 'dashboard') return cmdTerminalDashboard(args);
}

function drawDashboard(snapshot, schedulerRunning, selected) {
  const width = process.stdout.columns || 80;
  const compact = width < 76;
  const totals = snapshot.totals;
  const latest = snapshot.latestActivity ? new Date(snapshot.latestActivity).toLocaleString() : 'No activity yet';

  console.log(pc.bold(pc.cyan('JobPilot Dashboard')));
  console.log(pc.gray('Local job agent across CLI, dashboard, automation, and notifications'));
  console.log();

  if (compact) {
    console.log(`Scheduler: ${schedulerRunning ? pc.green('running') : pc.red('stopped')}`);
    console.log(`Profiles: ${totals.profiles} | Applied: ${totals.applied} | Review: ${totals.reviewed + totals.pendingApply}`);
    console.log(`Today: ${totals.todayJobs} found, ${totals.todayApplied} applied`);
    console.log();
  } else {
    console.log(`${pc.bold('STATUS')}    Scheduler ${schedulerRunning ? pc.green('running') : pc.red('stopped')}    Profiles ${pc.white(totals.profiles)}    Last activity ${pc.white(latest)}`);
    console.log(`${pc.bold('TODAY')}     Jobs found ${pc.white(totals.todayJobs)}    Applied ${pc.green(totals.todayApplied)}    Review queue ${pc.yellow(totals.reviewed + totals.pendingApply)}    Failures ${pc.red(totals.failed)}`);
    console.log();
  }

  console.log(pc.bold('What would you like to do?'));
  ACTIONS.forEach((action, index) => {
    const marker = index === selected ? pc.cyan('>') : ' ';
    const label = index === selected ? pc.bold(pc.white(action.label)) : action.label;
    const hint = compact ? '' : pc.gray(` - ${action.hint}`);
    console.log(` ${marker} ${label}${hint}`);
  });
  console.log();
  console.log(pc.gray('Use arrow keys and Enter. Press Ctrl+C to quit.'));
}

function isSchedulerRunning() {
  try {
    const output = execSync('npx pm2 jlist', {
      encoding: 'utf8',
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      windowsHide: true
    });
    const apps = JSON.parse(output);
    return apps.some((app) => app.name === 'jobpilot-scheduler' && app.pm2_env?.status === 'online');
  } catch {
    return false;
  }
}

function clearScreen() {
  readline.cursorTo(process.stdout, 0, 0);
  readline.clearScreenDown(process.stdout);
}

function hideCursor() {
  process.stdout.write('\x1b[?25l');
}

function showCursor() {
  process.stdout.write('\x1b[?25h');
}

function enterAlternateScreen() {
  process.stdout.write('\x1b[?1049h');
}

function exitAlternateScreen() {
  process.stdout.write('\x1b[?1049l');
}

function waitForEnter() {
  console.log();
  console.log(pc.gray('Press Enter to return to JobPilot.'));
  process.stdin.setRawMode(false);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('', () => {
      rl.close();
      resolve();
    });
  });
}

export const COMMANDS = Object.freeze([
  {
    name: 'menu',
    category: 'Start',
    summary: 'Interactive launcher',
    aliases: ['interactive'],
    usage: 'jobpilot',
    load: async () => (await import('./launcher.js')).cmdLauncher
  },
  {
    name: 'init',
    category: 'Setup',
    summary: 'Create or update a profile',
    aliases: ['setup', 'onboard'],
    usage: 'jobpilot init',
    load: async () => (await import('./onboarding.js')).interactiveInit
  },
  {
    name: 'settings',
    category: 'Setup',
    summary: 'Edit a profile interactively',
    aliases: ['config'],
    usage: 'jobpilot settings --profile=<name>',
    load: async () => (await import('./commands.js')).cmdSettings
  },
  {
    name: 'setup-email',
    category: 'Setup',
    summary: 'Configure IMAP response tracking',
    aliases: ['email'],
    usage: 'jobpilot setup-email',
    load: async () => (await import('./commands.js')).cmdSetupEmail
  },
  {
    name: 'telegram',
    category: 'Setup',
    summary: 'Link a local Telegram bot/chat',
    aliases: ['setup-telegram', 'bot'],
    usage: 'jobpilot telegram --profile=<name>',
    profileAware: true,
    load: async () => (await import('./telegram.js')).cmdTelegram
  },
  {
    name: 'run',
    category: 'Run',
    summary: 'Run one foreground pass',
    aliases: ['once'],
    usage: 'jobpilot run --profile=<name> [--allow-gateway-submit]',
    profileAware: true,
    load: async () => (await import('./runOnce.js')).cmdRun
  },
  {
    name: 'scheduler',
    category: 'Run',
    summary: 'Run the foreground scheduler',
    aliases: ['serve', 'worker'],
    usage: 'jobpilot scheduler --profile=<name>',
    profileAware: true,
    load: async () => (await import('./schedulerCmd.js')).cmdSchedulerForeground
  },
  {
    name: 'review',
    category: 'Run',
    summary: 'Walk the manual-review queue',
    aliases: ['reviews'],
    usage: 'jobpilot review --profile=<name>',
    profileAware: true,
    load: async () => (await import('./review.js')).cmdReview
  },
  {
    name: 'reset-jobs',
    category: 'Run',
    summary: 'Reprocess non-applied jobs',
    aliases: ['retry-jobs', 'retry-failed-ai'],
    usage: 'jobpilot reset-jobs --profile=<name> [--all-non-applied]',
    profileAware: true,
    load: async () => (await import('./resetJobs.js')).cmdResetJobs
  },
  {
    name: 'dashboard',
    category: 'Monitor',
    summary: 'Local terminal dashboard',
    aliases: ['dash', 'tui'],
    usage: 'jobpilot dashboard',
    load: async () => (await import('./dashboard.js')).cmdDashboard
  },
  {
    name: 'status',
    category: 'Monitor',
    summary: 'One-shot profile and activity snapshot',
    aliases: ['snapshot', 'stats'],
    usage: 'jobpilot status --profile=<name>',
    profileAware: true,
    load: async () => (await import('./snapshot.js')).cmdSnapshot
  },
  {
    name: 'profiles',
    category: 'Monitor',
    summary: 'List configured profiles',
    aliases: ['profile', 'ls'],
    usage: 'jobpilot profiles',
    load: async () => (await import('./commands.js')).cmdProfiles
  },
  {
    name: 'doctor',
    category: 'Monitor',
    summary: 'Diagnose install and profile config',
    aliases: ['check', 'health'],
    usage: 'jobpilot doctor --profile=<name>',
    profileAware: true,
    load: async () => (await import('./doctor.js')).cmdDoctor
  },
  {
    name: 'chat',
    category: 'Monitor',
    summary: 'Open the profile-aware AI assistant',
    aliases: ['ask'],
    usage: 'jobpilot chat --profile=<name>',
    profileAware: true,
    load: async () => (await import('./chat.js')).interactiveChat
  },
  {
    name: 'start',
    category: 'Background',
    summary: 'Start scheduler via PM2',
    usage: 'jobpilot start --profile=<name>',
    profileAware: true,
    load: async () => (await import('./commands.js')).cmdStart
  },
  {
    name: 'stop',
    category: 'Background',
    summary: 'Stop the PM2 scheduler',
    usage: 'jobpilot stop',
    load: async () => (await import('./commands.js')).cmdStop
  },
  {
    name: 'restart',
    category: 'Background',
    summary: 'Restart the PM2 scheduler',
    usage: 'jobpilot restart',
    load: async () => (await import('./commands.js')).cmdRestart
  },
  {
    name: 'logs',
    category: 'Background',
    summary: 'Stream PM2 scheduler logs',
    aliases: ['log'],
    usage: 'jobpilot logs --lines=50',
    load: async () => (await import('./commands.js')).cmdLogs
  },
  {
    name: 'queue',
    category: 'Background',
    summary: 'Show hosted dashboard review/apply queue',
    usage: 'jobpilot queue --profile=<name>',
    profileAware: true,
    load: async () => (await import('./commands.js')).cmdQueue
  },
  {
    name: 'register',
    category: 'Account',
    summary: 'Create an optional hosted dashboard account',
    usage: 'jobpilot register',
    load: async () => (await import('./commands.js')).cmdRegister
  },
  {
    name: 'login',
    category: 'Account',
    summary: 'Sign in for hosted dashboard sync',
    usage: 'jobpilot login',
    load: async () => (await import('./commands.js')).cmdLogin
  },
  {
    name: 'logout',
    category: 'Account',
    summary: 'Sign out of hosted dashboard sync',
    usage: 'jobpilot logout',
    load: async () => (await import('./commands.js')).cmdLogout
  },
  {
    name: 'whoami',
    category: 'Account',
    summary: 'Show current hosted dashboard account',
    usage: 'jobpilot whoami',
    load: async () => (await import('./commands.js')).cmdWhoami
  }
]);

const COMMAND_BY_NAME = new Map();
for (const command of COMMANDS) {
  COMMAND_BY_NAME.set(command.name, command);
  for (const alias of command.aliases || []) COMMAND_BY_NAME.set(alias, command);
}

export function parseArgs(argv) {
  const result = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      result._.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith('--')) {
      const [rawKey, ...rest] = arg.slice(2).split('=');
      const key = normalizeFlagName(rawKey);
      const inlineValue = rest.length ? rest.join('=') : undefined;
      if (inlineValue !== undefined) {
        result[key] = coerceValue(inlineValue);
      } else if (argv[i + 1] && !argv[i + 1].startsWith('-')) {
        result[key] = coerceValue(argv[i + 1]);
        i += 1;
      } else {
        result[key] = true;
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      for (const key of arg.slice(1)) result[normalizeFlagName(key)] = true;
    } else {
      result._.push(arg);
    }
  }
  return result;
}

export function resolveCommand(rawCommand) {
  const name = normalizeCommandName(rawCommand || 'menu');
  if (['help', '--help', '-h'].includes(name)) return { kind: 'help' };
  if (['version', '--version', '-v'].includes(name)) return { kind: 'version' };
  const command = COMMAND_BY_NAME.get(name);
  return command ? { kind: 'command', command } : { kind: 'unknown', name };
}

export function commandNames() {
  return COMMANDS.map((command) => command.name);
}

export function commandsByCategory() {
  const groups = new Map();
  for (const command of COMMANDS.filter((item) => item.name !== 'menu')) {
    if (!groups.has(command.category)) groups.set(command.category, []);
    groups.get(command.category).push(command);
  }
  return groups;
}

export function applyCommandArgDefaults(command, args) {
  const next = { ...args, _: [...(args._ || [])] };
  if (command.profileAware && !next.profile && !next.p && next._.length === 1) {
    next.profile = next._[0];
  }
  return next;
}

export function wantsHelp(args = {}) {
  return Boolean(args.help || args.h);
}

export function wantsVersion(args = {}) {
  return Boolean(args.version || args.v);
}

export function suggestCommand(input) {
  const normalized = normalizeCommandName(input);
  let best = null;
  for (const candidate of COMMAND_BY_NAME.keys()) {
    const distance = levenshtein(normalized, candidate);
    if (!best || distance < best.distance) best = { candidate, distance };
  }
  if (!best || best.distance > 3) return '';
  return COMMAND_BY_NAME.get(best.candidate)?.name || best.candidate;
}

function normalizeFlagName(value) {
  return String(value || '').trim().replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function normalizeCommandName(value) {
  return String(value || '').trim().toLowerCase();
}

function coerceValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

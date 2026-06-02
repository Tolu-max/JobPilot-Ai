// ANSI color codes — zero dependencies
export const c = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  italic:  '\x1b[3m',
  under:   '\x1b[4m',
  // Colors
  black:   '\x1b[30m',
  red:     '\x1b[91m',
  green:   '\x1b[92m',
  yellow:  '\x1b[93m',
  blue:    '\x1b[94m',
  magenta: '\x1b[95m',
  cyan:    '\x1b[96m',
  white:   '\x1b[97m',
  gray:    '\x1b[90m',
  // Named aliases used in the app
  indigo:  '\x1b[94m',
  purple:  '\x1b[35m',
  // Backgrounds
  bgBlue:    '\x1b[44m',
  bgGreen:   '\x1b[42m',
  bgRed:     '\x1b[41m',
  bgYellow:  '\x1b[43m',
  bgMagenta: '\x1b[45m',
};

// ─────────────────────────────────────────────────────────────────────────────
// Banner
// ─────────────────────────────────────────────────────────────────────────────

export function printBanner(version = '1.0.0') {
  const width = 52;
  const line = '─'.repeat(width);

  console.log();
  console.log(`  ${c.gray}${line}${c.reset}`);
  console.log();
  console.log(`${c.cyan}${c.bold}       __       __    ____  _ __      __ ${c.reset}`);
  console.log(`${c.cyan}${c.bold}      / /___   / /_  / __ \\(_) /___  / /_${c.reset}`);
  console.log(`${c.blue}${c.bold} __  / / __ \\ / __ \\/ /_/ / / / __ \\/ __/${c.reset}`);
  console.log(`${c.blue}${c.bold}/ /_/ / /_/ // /_/ / ____/ / / /_/ / /_  ${c.reset}`);
  console.log(`${c.magenta}${c.bold}\\____/\\____//_.___/_/   /_/_/\\____/\\__/  ${c.reset}`);
  console.log();
  console.log(`  ${c.gray}  Local-first job automation CLI${c.reset}`);
  console.log(`  ${c.gray}  v${version}${c.reset}`);
  console.log();
  console.log(`  ${c.gray}${line}${c.reset}`);
  console.log();
}

// ─────────────────────────────────────────────────────────────────────────────
// Logging helpers
// ─────────────────────────────────────────────────────────────────────────────

export function printSuccess(msg) {
  console.log(`  ${c.bgGreen}${c.black}${c.bold}  ✓  ${c.reset}  ${c.green}${msg}${c.reset}`);
}

export function printError(msg) {
  console.log(`  ${c.bgRed}${c.white}${c.bold}  ✗  ${c.reset}  ${c.red}${msg}${c.reset}`);
}

export function printInfo(msg) {
  console.log(`  ${c.gray}│${c.reset}  ${msg}`);
}

export function printWarn(msg) {
  console.log(`  ${c.bgYellow}${c.black}${c.bold}  ⚠  ${c.reset}  ${c.yellow}${msg}${c.reset}`);
}

export function printStep(n, total, msg) {
  const pct = Math.round((n / total) * 100);
  const bar = buildProgressBar(pct, 20);
  console.log(`\n  ${c.gray}Step ${n}/${total}  ${bar}  ${pct}%${c.reset}  ${c.white}${c.bold}${msg}${c.reset}`);
}

export function printSectionHeader(title) {
  const termWidth = Math.min(process.stdout.columns || 72, 72);
  const label = ` ${title} `;
  const after = Math.max(0, termWidth - label.length - 4);
  console.log(`\n  ${c.blue}${c.bold}◆${c.reset}${c.bold}${label}${c.reset}${c.gray}${'─'.repeat(after)}${c.reset}\n`);
}

export function printHint(msg) {
  console.log(`  ${c.gray}↳  ${msg}${c.reset}`);
}

export function printKeyValue(key, value, { color = c.white } = {}) {
  const k = `${c.gray}${String(key).padEnd(18)}${c.reset}`;
  console.log(`  ${k}  ${color}${value}${c.reset}`);
}

export function printBox(lines, { color = c.blue, title = '' } = {}) {
  const maxLen = Math.max(...lines.map(l => stripAnsi(l).length), title.length);
  const w = maxLen + 4;
  const topLine = title
    ? `┌─ ${title} ${'─'.repeat(Math.max(0, w - title.length - 4))}┐`
    : `┌${'─'.repeat(w)}┐`;

  console.log(`  ${color}${topLine}${c.reset}`);
  for (const line of lines) {
    const pad = maxLen - stripAnsi(line).length;
    console.log(`  ${color}│${c.reset}  ${line}${' '.repeat(pad)}  ${color}│${c.reset}`);
  }
  console.log(`  ${color}└${'─'.repeat(w)}┘${c.reset}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Table
// ─────────────────────────────────────────────────────────────────────────────

export function printTable(rows, headers) {
  const widths = headers.map((h, i) =>
    Math.max(stripAnsi(h).length, ...rows.map(r => stripAnsi(String(r[i] ?? '')).length))
  );
  const fmt = (row) =>
    row.map((v, i) => {
      const str = String(v ?? '');
      const raw = stripAnsi(str);
      return ` ${str}${' '.repeat(Math.max(0, widths[i] - raw.length))} `;
    }).join(`${c.gray}│${c.reset}`);

  const sep = (l, m, r) =>
    `  ${c.gray}${l}${widths.map(w => '─'.repeat(w + 2)).join(m)}${r}${c.reset}`;

  console.log(sep('┌', '┬', '┐'));
  console.log(`  ${c.gray}│${c.reset}${fmt(headers.map(h => `${c.bold}${h}${c.reset}`))}${c.gray}│${c.reset}`);
  console.log(sep('├', '┼', '┤'));
  for (const row of rows) {
    console.log(`  ${c.gray}│${c.reset}${fmt(row)}${c.gray}│${c.reset}`);
  }
  console.log(sep('└', '┴', '┘'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Spinner
// ─────────────────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function createSpinner(text) {
  let i = 0;
  let interval = null;
  const isTTY = Boolean(process.stdout.isTTY);

  const render = () => {
    if (!isTTY) return;
    process.stdout.write(`\r  ${c.blue}${SPINNER_FRAMES[i % SPINNER_FRAMES.length]}${c.reset}  ${text}   `);
    i++;
  };

  return {
    start() {
      if (isTTY) { render(); interval = setInterval(render, 80); }
      else console.log(`  ${c.blue}…${c.reset}  ${text}`);
      return this;
    },
    succeed(msg) {
      clearInterval(interval);
      if (isTTY) process.stdout.write('\r' + ' '.repeat(text.length + 12) + '\r');
      printSuccess(msg || text);
      return this;
    },
    fail(msg) {
      clearInterval(interval);
      if (isTTY) process.stdout.write('\r' + ' '.repeat(text.length + 12) + '\r');
      printError(msg || text);
      return this;
    },
    update(msg) {
      text = msg;
      return this;
    },
    stop() {
      clearInterval(interval);
      if (isTTY) process.stdout.write('\r' + ' '.repeat(text.length + 12) + '\r');
      return this;
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function buildProgressBar(pct, width = 20) {
  const filled = Math.round((pct / 100) * width);
  const empty  = width - filled;
  const color  = pct < 30 ? c.red : pct < 70 ? c.yellow : c.green;
  return `${c.gray}[${color}${'█'.repeat(filled)}${c.gray}${'░'.repeat(empty)}]${c.reset}`;
}

// Strip ANSI escape codes for length calculations
function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return String(str).replace(/\x1b\[[0-9;]*m/g, '');
}

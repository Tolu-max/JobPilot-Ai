#!/usr/bin/env node
import 'dotenv/config';
import fs from 'node:fs';
import pc from 'picocolors';
import {
  applyCommandArgDefaults,
  commandNames,
  commandsByCategory,
  parseArgs,
  resolveCommand,
  suggestCommand,
  wantsHelp,
  wantsVersion
} from './src/cli/commandRegistry.js';

const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));
const version = pkg.version;

const rawArgv = process.argv.slice(2);
const rawCmd = rawArgv[0]?.startsWith('-') ? undefined : rawArgv[0];
const args = parseArgs(rawCmd ? rawArgv.slice(1) : rawArgv);
const resolved = resolveCommand(rawCmd);

try {
  if (wantsVersion(args) || resolved.kind === 'version') {
    console.log(`jobpilot v${version}`);
    process.exit(0);
  }

  if (!rawCmd && wantsHelp(args)) {
    printHelp();
    process.exit(0);
  }

  if (resolved.kind === 'help') {
    printHelp();
    process.exit(0);
  }

  if (resolved.kind === 'unknown') {
    printUnknownCommand(resolved.name);
    process.exitCode = 1;
  } else {
    const command = resolved.command;
    if (wantsHelp(args)) {
      printCommandHelp(command);
    } else {
      const handler = await command.load();
      await handler(applyCommandArgDefaults(command, args));
    }
  }
} catch (err) {
  console.log();
  console.log(pc.red(`  Error: ${err.message}`));
  if (process.env.DEBUG) console.log(pc.dim(err.stack));
  const commandName = resolved.kind === 'command' ? resolved.command.name : rawCmd || 'help';
  console.log(pc.dim(`  Run: jobpilot ${commandName} --help`));
  console.log();
  process.exit(1);
}

function printHelp() {
  console.log();
  console.log(`  ${pc.bold(pc.cyan('JobPilot'))} ${pc.dim('v' + version)}`);
  console.log(`  ${pc.dim('Usage:')} ${pc.white('jobpilot')} ${pc.dim('<command> [--profile=<name>] [flags]')}`);
  console.log();
  console.log(`  ${pc.dim('Run')} ${pc.cyan('jobpilot')} ${pc.dim('with no command for the interactive menu.')}`);
  console.log(`  ${pc.dim('Shortcut:')} ${pc.cyan('jobpilot run sister')} ${pc.dim('is the same as')} ${pc.cyan('jobpilot run --profile=sister')}`);

  for (const [category, commands] of commandsByCategory()) {
    console.log();
    console.log(`  ${pc.bold(pc.white(category))}`);
    for (const command of commands) {
      const aliases = command.aliases?.length ? pc.dim(` (${command.aliases.join(', ')})`) : '';
      console.log(`  ${pc.cyan(pc.bold(command.name.padEnd(14)))}${pc.dim(command.summary)}${aliases}`);
    }
  }

  console.log();
  console.log(`  ${pc.bold(pc.white('Meta'))}`);
  console.log(`  ${pc.cyan(pc.bold('help'.padEnd(14)))}${pc.dim('Show this help')}`);
  console.log(`  ${pc.cyan(pc.bold('version'.padEnd(14)))}${pc.dim('Print version')}`);
  console.log();
  console.log(`  ${pc.dim('Docs:')} ${pc.cyan('README.md')}`);
  console.log();
}

function printCommandHelp(command) {
  console.log();
  console.log(`  ${pc.bold(pc.cyan(`jobpilot ${command.name}`))}`);
  console.log(`  ${pc.dim(command.summary)}`);
  console.log();
  console.log(`  ${pc.dim('Usage:')} ${pc.white(command.usage || `jobpilot ${command.name}`)}`);
  if (command.aliases?.length) {
    console.log(`  ${pc.dim('Aliases:')} ${command.aliases.map((alias) => pc.cyan(alias)).join(', ')}`);
  }
  if (command.profileAware) {
    console.log(`  ${pc.dim('Profile:')} pass ${pc.cyan('--profile=<name>')} or a positional profile name.`);
  }
  console.log();
}

function printUnknownCommand(name) {
  console.log();
  console.log(pc.red(`  Unknown command: ${pc.white(name)}`));
  const suggestion = suggestCommand(name);
  if (suggestion) console.log(pc.dim(`  Did you mean ${pc.cyan('jobpilot ' + suggestion)}?`));
  console.log(pc.dim(`  Known commands: ${commandNames().join(', ')}`));
  console.log(pc.dim(`  Run ${pc.cyan('jobpilot help')} for details.`));
  console.log();
}

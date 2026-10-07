import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommandArgDefaults,
  parseArgs,
  resolveCommand,
  suggestCommand
} from '../src/cli/commandRegistry.js';

test('CLI parser supports flags, booleans, shorthand, and positional args', () => {
  assert.deepEqual(parseArgs(['--profile=sister', '--dry-run=false', '-hv', 'extra']), {
    _: ['extra'],
    profile: 'sister',
    dryRun: false,
    h: true,
    v: true
  });
});

test('CLI command registry resolves aliases and suggestions', () => {
  assert.equal(resolveCommand('dash').command.name, 'dashboard');
  assert.equal(resolveCommand('check').command.name, 'doctor');
  assert.equal(resolveCommand('setup-telegram').command.name, 'telegram');
  assert.equal(suggestCommand('docter'), 'doctor');
});

test('profile-aware commands accept a positional profile name', () => {
  const command = resolveCommand('run').command;
  const args = applyCommandArgDefaults(command, parseArgs(['sister']));

  assert.equal(args.profile, 'sister');
});

test('local automation commands are registered', () => {
  assert.equal(resolveCommand('start').command.name, 'start');
  assert.equal(resolveCommand('logs').command.name, 'logs');
  assert.equal(resolveCommand('dashboard').command.name, 'dashboard');
});

test('missing command resolves to the menu command', () => {
  assert.equal(resolveCommand(undefined).command.name, 'menu');
});

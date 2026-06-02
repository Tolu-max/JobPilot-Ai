import 'dotenv/config';
import { intro, outro, note, text, password, confirm, select, isCancel, cancel } from '@clack/prompts';
import pc from 'picocolors';
import path from 'node:path';
import { upsertEnvVars } from './envFile.js';

const ENV_PATH = path.join(process.cwd(), '.env');

export async function cmdTelegram(args = {}) {
  const profile = normalizeProfileName(args.profile || args.p || process.env.PROFILE || '');
  const profileUpper = profile ? profile.toUpperCase().replace(/[^A-Z0-9]+/g, '_') : '';

  intro(pc.bgCyan(pc.black(' JobPilot Telegram Setup ')));
  note([
    'Use your own Telegram bot token from @BotFather.',
    'JobPilot stores it in your local .env file; the hosted dashboard does not need this token.',
    profile ? `This setup will link chat routing for profile: ${profile}` : 'No profile selected; this will write the default TELEGRAM_CHAT_ID.'
  ].join('\n'));

  const existingToken = process.env.TELEGRAM_BOT_TOKEN || '';
  let token = existingToken;
  if (existingToken) {
    const keepExisting = await askConfirm('Use the existing TELEGRAM_BOT_TOKEN from .env?', true);
    if (!keepExisting) token = '';
  }
  if (!token) token = await askSecret('Telegram bot token from @BotFather:');
  if (!token) {
    cancel('Telegram bot token is required.');
    process.exit(1);
  }

  const bot = await getBotIdentity(token);
  if (!bot.ok) {
    cancel(`Could not validate Telegram bot token: ${bot.reason}`);
    process.exit(1);
  }

  note([
    `Bot connected: @${bot.username}`,
    'Open Telegram, send this bot /start, then come back here.'
  ].join('\n'));
  await askText('Press Enter after you have messaged the bot:', '');

  const chats = await discoverChats(token);
  let chatId = '';
  if (chats.length === 1) {
    chatId = chats[0].id;
    note(`Found chat: ${chats[0].label} (${chatId})`);
  } else if (chats.length > 1) {
    chatId = await select({
      message: 'Which Telegram chat should JobPilot use?',
      options: chats.map((chat) => ({ value: chat.id, label: chat.label, hint: chat.id }))
    });
    if (isCancel(chatId)) abort();
  } else {
    note('No recent chat found. This can happen if Telegram has no pending updates for the bot.');
    chatId = await askText('Paste Telegram chat ID:', process.env.TELEGRAM_CHAT_ID || '');
  }
  if (!chatId) {
    cancel('Telegram chat ID is required.');
    process.exit(1);
  }

  const envUpdates = {
    TELEGRAM_BOT_TOKEN: token
  };
  if (profileUpper) envUpdates[`${profileUpper}_TELEGRAM_CHAT_ID`] = chatId;
  else envUpdates.TELEGRAM_CHAT_ID = chatId;

  await upsertEnvVars(ENV_PATH, envUpdates);

  const sendTest = await askConfirm('Send a test message now?', true);
  if (sendTest) {
    const result = await sendTestMessage(token, chatId, profile || 'default');
    if (!result.ok) {
      cancel(`Telegram setup saved, but test message failed: ${result.reason}`);
      process.exit(1);
    }
  }

  outro([
    pc.bold('Telegram is linked.'),
    profile ? `Profile chat env: ${profileUpper}_TELEGRAM_CHAT_ID` : 'Default chat env: TELEGRAM_CHAT_ID',
    'Try: jobpilot doctor'
  ].join('\n'));
}

async function getBotIdentity(token) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      return { ok: false, reason: data.description || `HTTP ${response.status}` };
    }
    return { ok: true, username: data.result?.username || 'unknown' };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

async function discoverChats(token) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?allowed_updates=${encodeURIComponent(JSON.stringify(['message']))}`, {
      signal: AbortSignal.timeout(15000)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) return [];
    const chats = new Map();
    for (const update of data.result || []) {
      const chat = update.message?.chat;
      if (!chat?.id) continue;
      const name = [chat.title, chat.first_name, chat.last_name, chat.username ? `@${chat.username}` : '']
        .filter(Boolean)
        .join(' ');
      chats.set(String(chat.id), { id: String(chat.id), label: name || String(chat.id) });
    }
    return [...chats.values()].slice(-10);
  } catch {
    return [];
  }
}

async function sendTestMessage(token, chatId, profile) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        chat_id: chatId,
        text: `JobPilot Telegram is connected for profile "${profile}". Run /help for commands.`,
        disable_web_page_preview: true
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      return { ok: false, reason: data.description || `HTTP ${response.status}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

async function askText(message, initialValue = '') {
  const result = await text({ message, initialValue });
  if (isCancel(result)) abort();
  return String(result || '').trim();
}

async function askSecret(message) {
  const result = await password({ message });
  if (isCancel(result)) abort();
  return String(result || '').trim();
}

async function askConfirm(message, initialValue = false) {
  const result = await confirm({ message, initialValue });
  if (isCancel(result)) abort();
  return Boolean(result);
}

function abort() {
  cancel('Telegram setup aborted.');
  process.exit(0);
}

function normalizeProfileName(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '');
}

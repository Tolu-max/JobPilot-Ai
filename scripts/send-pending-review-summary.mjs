import { buildConfig } from '../src/config.js';
import { sendPendingReviews } from '../src/telegramBot.js';

const profileName = String(process.argv.find((arg) => arg.startsWith('--profile='))?.split('=')[1] || 'sister');
const config = buildConfig(['node', 'jobpilot', `--profile=${profileName}`]);
const recipient = String(config.telegramChatId || '').trim();
if (!recipient) throw new Error(`No Telegram chat configured for ${profileName}`);
await sendPendingReviews(config, recipient);
console.log(`[telegram] sent pending review summary for ${profileName}`);

import { emitEvent, EventTypes } from '../eventBus.js';

export function resolveTelegramRecipient(config = {}, event = {}) {
  const userId = event.user_id || event.userId || config.userId || config.profileName || 'local';
  const profileId = event.profile_id || event.profileId || config.profileName || 'default';
  const routes = config.notificationRoutes || config.preferences?.notificationRoutes || {};
  const routeKey = `${userId}:${profileId}`;
  const route = routes[routeKey] || routes[profileId] || null;
  const chatId = route?.telegram_chat_id || route?.telegramChatId || config.telegramChatId || '';

  return {
    user_id: userId,
    profile_id: profileId,
    telegram_chat_id: String(chatId || '').trim(),
    verified_at: route?.verified_at || route?.verifiedAt || null
  };
}

export function assertTelegramChatAllowed(config = {}, chatId, event = {}) {
  const recipient = resolveTelegramRecipient(config, event);
  if (!recipient.telegram_chat_id) return false;
  return String(chatId || '').trim() === recipient.telegram_chat_id;
}

export function buildNotificationEvent(type, details = {}, config = {}) {
  return {
    type,
    user_id: details.user_id || config.userId || config.profileName || 'local',
    profile_id: details.profile_id || config.profileName || 'default',
    title: details.title || details.job?.title || '',
    company: details.company || details.job?.company || '',
    status: details.status || '',
    timestamp: details.timestamp || new Date().toISOString(),
    job_url: details.job_url || details.job?.applicationUrl || details.job?.job_url || '',
    message: details.message || ''
  };
}

export async function recordNotificationResult(result, config = {}) {
  const type = result.ok ? EventTypes.NOTIFICATION_SENT : EventTypes.NOTIFICATION_FAILED;
  await emitEvent(type, result, config).catch(() => {});
}

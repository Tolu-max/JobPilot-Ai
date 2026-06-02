import { appendLog } from './logger.js';
import {
  buildNotificationEvent,
  recordNotificationResult,
  resolveTelegramRecipient
} from './notifications/router.js';

export async function sendNotification(message, config, details = {}) {
  const cleanMessage = String(message || '').trim();
  if (!cleanMessage) return;

  const profilePrefix = config?.displayName || config?.profileName
    ? `[${config.displayName || config.profileName}] `
    : '';
  const text = `${profilePrefix}${cleanMessage}`;
  const event = buildNotificationEvent(details.type || 'system_message', {
    ...details,
    message: cleanMessage
  }, config);
  const recipient = resolveTelegramRecipient(config, event);

  if (!config?.telegramBotToken || !recipient.telegram_chat_id) {
    await appendLog(`Notification: ${text}`, config);
    await recordNotificationResult({ ok: false, reason: 'telegram_not_configured', event }, config);
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: recipient.telegram_chat_id,
        text,
        disable_web_page_preview: true
      })
    });

    if (!response.ok) {
      const responseText = await response.text();
      await appendLog(`Telegram notification failed: ${response.status} ${responseText}`, config);
      await recordNotificationResult({ ok: false, reason: responseText, event, recipient }, config);
      return;
    }

    await recordNotificationResult({ ok: true, event, recipient }, config);
  } catch (error) {
    await appendLog(`Telegram notification error: ${error.message}`, config);
    await recordNotificationResult({ ok: false, reason: error.message, event, recipient }, config);
  }
}

export async function notifyRunSummary(results, config, runSummary = {}) {
  const scanned = runSummary.jobsScanned ?? results.length;
  const deduped = runSummary.jobsDeduped ?? results.filter((item) => item.decision === 'duplicate' || item.status === 'duplicate').length;
  const newJobs = scanned - deduped;
  const ignored = runSummary.jobsIgnored ?? results.filter((item) => item.decision === 'ignore').length;
  const queued = runSummary.jobsQueuedForReview ?? results.filter((item) => item.status === 'pending').length;
  const applied = runSummary.jobsAutoApplied ?? results.filter((item) => item.status === 'applied').length;
  const processingErrors = runSummary.processingErrors ?? results.filter((item) => item.status === 'failed').length;
  const errors = (runSummary.errors?.length || 0) + processingErrors;

  if (scanned === 0 && applied === 0 && queued === 0 && errors === 0) return;

  await sendNotification(
    `Run: ${scanned} scraped, ${newJobs} new, ${ignored} ignored, ${queued} review, ${applied} applied, ${errors} errors.`,
    config,
    { type: 'run_summary', status: errors > 0 ? 'warning' : 'ok' }
  );

  const freshApplied = results.filter((item) => item.status === 'applied' && !item.deduped);
  for (const item of uniqueSummaryItems(freshApplied).slice(0, 5)) {
    await sendNotification(`${item.title} - ${item.score} - Applied`, config, {
      type: 'application_submitted',
      title: item.title,
      status: 'applied',
      job_url: item.url
    });
  }
}

function uniqueSummaryItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.url || item.title;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

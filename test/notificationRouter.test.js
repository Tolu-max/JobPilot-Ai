import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertTelegramChatAllowed,
  buildNotificationEvent,
  resolveTelegramRecipient
} from '../src/notifications/router.js';

test('notification router resolves profile scoped Telegram routes', () => {
  const config = {
    profileName: 'tolu',
    userId: 'user-1',
    notificationRoutes: {
      'user-1:tolu': {
        telegram_chat_id: '12345',
        verified_at: '2026-05-27T00:00:00.000Z'
      }
    }
  };

  const event = buildNotificationEvent('application_submitted', {
    title: 'SEO Specialist',
    status: 'applied'
  }, config);
  const recipient = resolveTelegramRecipient(config, event);

  assert.equal(recipient.telegram_chat_id, '12345');
  assert.equal(assertTelegramChatAllowed(config, '12345', event), true);
  assert.equal(assertTelegramChatAllowed(config, '999', event), false);
});

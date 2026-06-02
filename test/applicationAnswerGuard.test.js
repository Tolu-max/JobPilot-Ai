import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGroundedFallbackAnswer,
  cleanApplicationAnswer,
  validateApplicationAnswer
} from '../src/applicationAnswerGuard.js';

const groundedConfig = {
  candidateProfile: {
    skills: ['Customer Support', 'Google Workspace', 'Administrative Support'],
    strengths: ['Clear communication'],
    resumeTextPreview: 'Customer support specialist using Google Workspace for admin support and email responses.'
  },
  cvData: {
    skills: ['Customer Support', 'Google Workspace'],
    rawTextPreview: 'Handled customer support, email support, live chat, and admin coordination.'
  }
};

test('application answer guard extracts plain answer text from JSON AI output', () => {
  const answer = cleanApplicationAnswer('{"answer":"I have handled customer support through email and live chat."}');

  assert.equal(answer, 'I have handled customer support through email and live chat.');
});

test('application answer guard replaces unsupported affirmative claims', () => {
  const result = validateApplicationAnswer({
    question: 'Do you have experience with QuickBooks bookkeeping?',
    answer: 'Yes, I have used QuickBooks for bookkeeping and monthly reporting.',
    config: groundedConfig,
    candidate: groundedConfig.cvData
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /unsupported affirmative claim/i);
  assert.match(result.answer, /not have that exact quickbooks bookkeeping experience/i);
  assert.doesNotMatch(result.answer, /^yes\b/i);
});

test('application answer guard allows supported affirmative claims', () => {
  const result = validateApplicationAnswer({
    question: 'Do you have experience with customer support?',
    answer: 'Yes, I have handled customer support through email and live chat.',
    config: groundedConfig,
    candidate: groundedConfig.cvData
  });

  assert.equal(result.ok, true);
  assert.equal(result.answer, 'Yes, I have handled customer support through email and live chat.');
});

test('grounded fallback avoids unsupported yes/no overclaiming', () => {
  const answer = buildGroundedFallbackAnswer(
    'Have you worked with NetSuite ERP?',
    { general: 'Yes, I have relevant experience with NetSuite ERP.' },
    groundedConfig,
    groundedConfig.cvData
  );

  assert.match(answer, /not have that exact netsuite erp experience/i);
  assert.doesNotMatch(answer, /^yes\b/i);
});

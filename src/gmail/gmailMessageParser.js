/**
 * Gmail Message Parser
 *
 * Extracts structured, sanitized headers, body text, links, and metadata
 * from raw Gmail API message resources.
 */

import { compactText } from '../utils.js';

export function parseGmailMessage(rawMessage = {}) {
  const id = rawMessage.id || '';
  const threadId = rawMessage.threadId || '';
  const historyId = rawMessage.historyId || '';
  const internalDate = rawMessage.internalDate
    ? new Date(Number.parseInt(rawMessage.internalDate, 10)).toISOString()
    : new Date().toISOString();

  const headers = {};
  for (const h of rawMessage.payload?.headers || []) {
    headers[h.name.toLowerCase()] = h.value;
  }

  const fromRaw = headers['from'] || '';
  const toRaw = headers['to'] || '';
  const subject = headers['subject'] || '';
  const dateRaw = headers['date'] || internalDate;
  const messageIdHeader = headers['message-id'] || '';

  const { senderEmail, senderName } = parseSender(fromRaw);
  const bodyText = extractBodyText(rawMessage.payload);
  const snippet = rawMessage.snippet || '';

  return {
    id,
    threadId,
    historyId,
    messageIdHeader,
    receivedAt: internalDate,
    dateHeader: dateRaw,
    from: fromRaw,
    senderEmail,
    senderName,
    senderDomain: extractDomain(senderEmail),
    to: toRaw,
    subject: compactText(subject),
    snippet: compactText(snippet),
    bodyText: normalizeEmailText(bodyText || snippet),
    rawLabels: rawMessage.labelIds || []
  };
}

function parseSender(fromStr = '') {
  const match = String(fromStr).match(/^(?:"?([^"]*)"?\s)?(?:<?(.+@[^>]+)>?)$/);
  if (match) {
    return {
      senderName: compactText(match[1] || ''),
      senderEmail: String(match[2] || '').trim().toLowerCase()
    };
  }
  return {
    senderName: '',
    senderEmail: String(fromStr).trim().toLowerCase()
  };
}

function extractDomain(email = '') {
  return String(email || '').split('@')[1] || '';
}

function extractBodyText(payload) {
  if (!payload) return '';

  // 1. Single part text/plain
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  // 2. Multipart messages
  let collected = [];
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        collected.push(decodeBase64Url(part.body.data));
      } else if (part.mimeType === 'text/html' && part.body?.data && collected.length === 0) {
        collected.push(stripHtmlTags(decodeBase64Url(part.body.data)));
      } else if (Array.isArray(part.parts)) {
        collected.push(extractBodyText(part));
      }
    }
  }

  // 3. Fallback to HTML body if no plain text part exists
  if (collected.length === 0 && payload.mimeType === 'text/html' && payload.body?.data) {
    return stripHtmlTags(decodeBase64Url(payload.body.data));
  }

  return collected.filter(Boolean).join('\n\n');
}

function decodeBase64Url(str = '') {
  try {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function stripHtmlTags(html = '') {
  return String(html || '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeEmailText(text = '') {
  return String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
}

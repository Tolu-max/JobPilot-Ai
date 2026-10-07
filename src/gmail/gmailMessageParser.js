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
  const normalizedBody = normalizeEmailText(bodyText || snippet);

  const extractedRoleTitle = extractRoleTitle(subject, normalizedBody);
  const extractedJobId = extractJobId(subject, normalizedBody);

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
    bodyText: normalizedBody,
    extractedRoleTitle,
    extractedJobId,
    rawLabels: rawMessage.labelIds || []
  };
}

export function extractRoleTitle(subject = '', bodyText = '') {
  const cleanSubject = compactText(subject);

  // 1. Subject extraction patterns
  const subjectPatterns = [
    /(.+?)\s*[-–—|]\s*Application Confirmation/i,
    /Application Confirmation:\s*(.+)/i,
    /Update on Your Application for the (.+)/i,
    /Update on Your Application for (.+)/i,
    /Application Update for the (.+)/i,
    /Application Update for (.+)/i,
    /Application Update:\s*(.+)/i,
    /Your Application for the (.+)/i,
    /Your Application for (.+)/i,
    /Your application to (.+)/i,
    /Rejection:\s*(.+)/i,
    /Job Offer:\s*(.+)/i,
    /Client Interview:\s*(.+)/i,
    /Interview Invitation:\s*(.+)/i
  ];

  for (const pattern of subjectPatterns) {
    const match = cleanSubject.match(pattern);
    if (match && match[1]) {
      const extracted = cleanExtractedRole(match[1]);
      if (extracted) return extracted;
    }
  }

  // 2. Body extraction patterns (BruntWork body patterns)
  const bodyPatterns = [
    /the job opening,\s*([^,\n]+?)\s+with the job ID number\s*(\d+)/i,
    /interest in the role:\s*([^\n\r.]+)/i,
    /application for the position of\s*([^\n\r.]+)/i,
    /application for the role of\s*([^\n\r.]+)/i,
    /application for the\s*([^\n\r.]+)\s+role/i,
    /application for\s*([^\n\r.]+)\s+at BruntWork/i
  ];

  for (const pattern of bodyPatterns) {
    const match = bodyText.match(pattern);
    if (match && match[1]) {
      const extracted = cleanExtractedRole(match[1]);
      if (extracted) return extracted;
    }
  }

  return '';
}

export function extractJobId(subject = '', bodyText = '') {
  const combined = `${subject}\n${bodyText}`;
  const patterns = [
    /with the job ID number\s*(\d+)/i,
    /job ID number\s*[:#]?\s*(\d+)/i,
    /job ID\s*[:#]?\s*(\d+)/i,
    /job\s*#\s*(\d+)/i
  ];

  for (const pattern of patterns) {
    const match = combined.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return '';
}

function cleanExtractedRole(roleStr = '') {
  let role = compactText(roleStr);
  // Strip trailing company or punctuation
  role = role.replace(/[\-–—|]\s*BruntWork.*$/i, '').trim();
  role = role.replace(/[.,;!?]$/, '').trim();
  return role;
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

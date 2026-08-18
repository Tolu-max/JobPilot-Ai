/**
 * Gmail Incremental Sync & Lifecycle Event Dispatcher
 *
 * Runs incrementally, maintains sync checkpoints, deduplicates messages,
 * updates jobStore post-application lifecycle, and notifies candidate via Telegram.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { GmailClient } from './gmailClient.js';
import { classifyEmailMessage, EmailEventType } from './gmailClassifier.js';
import { matchEmailToApplication, MatchConfidenceLevel } from './gmailApplicationMatcher.js';
import { loadJobStore, saveJobStore } from '../jobStore.js';
import { sendNotification } from '../notifications.js';

export async function syncGmailForProfile(config = {}) {
  const profileName = String(config.profileName || 'tolu').toLowerCase();
  const profileDir = config.profileDir || path.resolve(process.cwd(), 'profiles', profileName);
  const syncStatePath = path.join(profileDir, 'gmailSyncState.json');

  const client = new GmailClient(config);
  const isConfigured = await client.isConfigured();
  if (!isConfigured) {
    return { ok: true, skipped: true, reason: `Gmail not configured for profile: ${profileName}` };
  }

  // Check if tokens exist
  const tokens = await client.authenticator.loadTokens();
  if (!tokens?.refresh_token) {
    return { ok: true, skipped: true, reason: `Gmail refresh token not available for profile: ${profileName}` };
  }

  const syncState = await loadSyncState(syncStatePath);
  const processedMessageIds = new Set(syncState.processedMessageIds || []);

  // Build targeted search query
  const query = buildTargetedQuery(config);

  let searchResult;
  try {
    searchResult = await client.searchMessages(query, { maxResults: 25 });
  } catch (err) {
    console.warn(`[gmailSync] Search failed for ${profileName}: ${err.message}`);
    return { ok: false, error: err.message };
  }

  const messagesToFetch = (searchResult.messages || []).filter(m => !processedMessageIds.has(m.id));
  console.log(`[gmailSync] Found ${messagesToFetch.length} new messages for profile: ${profileName}`);

  let newEventsCount = 0;

  for (const msgMeta of messagesToFetch) {
    try {
      const parsedEmail = await client.getMessage(msgMeta.id);
      processedMessageIds.add(msgMeta.id);

      // 1. Classify Email
      const classificationResult = await classifyEmailMessage(parsedEmail, config);

      // 2. Match to Application
      const matchResult = await matchEmailToApplication(parsedEmail, config);

      // 3. Create Evidence Record
      const evidence = {
        eventId: `evt_${Date.now()}_${msgMeta.id.slice(-6)}`,
        gmailMessageId: msgMeta.id,
        threadId: parsedEmail.threadId,
        receivedAt: parsedEmail.receivedAt,
        sender: parsedEmail.from,
        senderEmail: parsedEmail.senderEmail,
        subject: parsedEmail.subject,
        classification: classificationResult.classification,
        classificationConfidence: classificationResult.confidence,
        classificationTier: classificationResult.tier,
        matchConfidenceLevel: matchResult.matchConfidenceLevel,
        matchConfidence: matchResult.confidence,
        matchedJobTitle: matchResult.jobRecord?.title || null,
        matchedJobHash: matchResult.jobRecord?.job_hash || null,
        interviewDetails: classificationResult.interviewDetails || null,
        excerpt: (parsedEmail.bodyText || parsedEmail.snippet || '').slice(0, 300)
      };

      // 4. Update Application State if matched
      if (matchResult.jobRecord && matchResult.matchConfidenceLevel !== MatchConfidenceLevel.UNMATCHED) {
        await updateJobLifecycleRecord(config, matchResult.jobRecord, evidence);
      }

      // 5. Send Telegram Notification
      await dispatchTelegramEvent(config, evidence, matchResult, classificationResult);

      newEventsCount += 1;
    } catch (err) {
      console.error(`[gmailSync] Error processing message ${msgMeta.id}:`, err.message);
    }
  }

  // Save updated sync checkpoint (keep recent 1000 message IDs to bound disk state)
  const updatedProcessedList = Array.from(processedMessageIds).slice(-1000);
  await saveSyncState(syncStatePath, {
    lastSyncAt: new Date().toISOString(),
    processedMessageIds: updatedProcessedList,
    lastEventsCount: newEventsCount
  });

  return { ok: true, eventsProcessed: newEventsCount };
}

function buildTargetedQuery(config = {}) {
  const allowedSenders = config.gmailAllowedSenders || process.env.GMAIL_ALLOWED_SENDERS || 'bruntwork, bruntwork.co, bruntwork.com';
  const sendersList = allowedSenders.split(',').map(s => s.trim()).filter(Boolean);

  const senderQuery = sendersList.length > 0
    ? `from:(${sendersList.join(' OR ')})`
    : 'from:(bruntwork OR bruntwork.co OR bruntwork.com)';

  return `${senderQuery} newer_than:45d`;
}

async function updateJobLifecycleRecord(config, jobRecord, evidence) {
  const store = await loadJobStore(config);
  const targetIndex = store.jobs.findIndex(j => j.job_hash === jobRecord.job_hash);

  if (targetIndex >= 0) {
    const job = store.jobs[targetIndex];
    const events = Array.isArray(job.lifecycleEvents) ? job.lifecycleEvents : [];

    // Avoid duplicate event inside job record
    if (!events.some(e => e.gmailMessageId === evidence.gmailMessageId)) {
      events.push(evidence);
    }

    const nextLifecycleStatus = mapClassificationToLifecycleStatus(evidence.classification, job.lifecycleStatus || job.status);

    store.jobs[targetIndex] = {
      ...job,
      lifecycleStatus: nextLifecycleStatus,
      lifecycleEvents: events,
      lastEmailEventAt: evidence.receivedAt,
      interviewDetails: evidence.interviewDetails || job.interviewDetails || null,
      updatedAt: new Date().toISOString()
    };

    await saveJobStore(config, store);
  }
}

function mapClassificationToLifecycleStatus(classification, currentStatus) {
  switch (classification) {
    case EmailEventType.CLIENT_INTERVIEW:
      return 'client_interview_invited';
    case EmailEventType.RECRUITER_INTERVIEW:
      return 'recruiter_interview_invited';
    case EmailEventType.ASSESSMENT:
      return 'assessment_requested';
    case EmailEventType.OFFER:
      return 'offer';
    case EmailEventType.REJECTION:
      return 'rejected';
    case EmailEventType.APPLICATION_CONFIRMATION:
      return 'application_confirmed';
    case EmailEventType.RECRUITER_RESPONSE:
      return 'recruiter_response';
    default:
      return currentStatus || 'applied';
  }
}

async function dispatchTelegramEvent(config, evidence, matchResult, classificationResult) {
  const classification = evidence.classification;
  if (classification === EmailEventType.UNKNOWN) return;

  const candidateName = String(config.profileName || 'Candidate').toUpperCase();
  const jobTitle = matchResult.jobRecord?.title || 'Unknown Role';
  const company = matchResult.jobRecord?.company || 'BruntWork';
  const confidenceLevel = matchResult.matchConfidenceLevel;

  let message = '';

  if (classification === EmailEventType.CLIENT_INTERVIEW || classification === EmailEventType.RECRUITER_INTERVIEW) {
    const stage = classification === EmailEventType.CLIENT_INTERVIEW ? 'Client Interview' : 'Recruiter Interview';
    const interview = classificationResult.interviewDetails || {};

    message = `🎯 *[${candidateName}] ${stage.toUpperCase()} DETECTED*\n\n`
      + `*Role:* ${escapeMarkdown(jobTitle)}\n`
      + `*Company:* ${escapeMarkdown(company)}\n`
      + `*Stage:* ${stage}\n`
      + (interview.scheduledAt ? `*Date/Time:* ${escapeMarkdown(interview.scheduledAt)} ${interview.timezone || ''}\n` : '')
      + (interview.platform ? `*Platform:* ${escapeMarkdown(interview.platform)}\n` : '')
      + (interview.meetingUrl ? `*Meeting Link:* ${interview.meetingUrl}\n` : '')
      + `*Sender:* ${escapeMarkdown(evidence.sender)}\n`
      + `*Match Confidence:* ${confidenceLevel}`;
  } else if (classification === EmailEventType.OFFER) {
    message = `🎉 *[${candidateName}] JOB OFFER DETECTED*\n\n`
      + `*Role:* ${escapeMarkdown(jobTitle)}\n`
      + `*Company:* ${escapeMarkdown(company)}\n`
      + `*Subject:* ${escapeMarkdown(evidence.subject)}\n`
      + `*Match Confidence:* ${confidenceLevel}`;
  } else if (classification === EmailEventType.REJECTION) {
    message = `❌ *[${candidateName}] APPLICATION UPDATE: REJECTION*\n\n`
      + `*Role:* ${escapeMarkdown(jobTitle)}\n`
      + `*Company:* ${escapeMarkdown(company)}\n`
      + `*Reason:* ${escapeMarkdown(evidence.excerpt.slice(0, 150))}\n`
      + `*Match Confidence:* ${confidenceLevel}`;
  } else if (classification === EmailEventType.ASSESSMENT) {
    message = `📝 *[${candidateName}] ASSESSMENT INVITATION*\n\n`
      + `*Role:* ${escapeMarkdown(jobTitle)}\n`
      + `*Company:* ${escapeMarkdown(company)}\n`
      + `*Subject:* ${escapeMarkdown(evidence.subject)}\n`
      + `*Match Confidence:* ${confidenceLevel}`;
  } else if (confidenceLevel === MatchConfidenceLevel.LOW || confidenceLevel === MatchConfidenceLevel.UNMATCHED) {
    message = `⚠️ *[${candidateName}] UNMATCHED / AMBIGUOUS EMAIL*\n\n`
      + `*Sender:* ${escapeMarkdown(evidence.sender)}\n`
      + `*Subject:* ${escapeMarkdown(evidence.subject)}\n`
      + `*Event Type:* ${classification}\n`
      + `*Excerpt:* ${escapeMarkdown(evidence.excerpt.slice(0, 150))}\n`
      + `*Match Confidence:* ${confidenceLevel}`;
  }

  if (message) {
    try {
      await sendNotification(message, config, { type: 'gmail_event' });
    } catch (err) {
      console.warn(`[gmailSync] Telegram notification failed: ${err.message}`);
    }
  }
}

function escapeMarkdown(text = '') {
  return String(text || '')
    .replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

async function loadSyncState(filepath) {
  try {
    const raw = await fs.readFile(filepath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { processedMessageIds: [], lastSyncAt: null };
  }
}

async function saveSyncState(filepath, state) {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * Gmail Incremental Sync & Lifecycle Event Dispatcher
 *
 * Runs incrementally, maintains sync checkpoints, deduplicates messages,
 * updates jobStore post-application lifecycle with monotonic safety,
 * and notifies candidate via Telegram only for live new events.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { GmailClient } from './gmailClient.js';
import { classifyEmailMessage, EmailEventType } from './gmailClassifier.js';
import { matchEmailToApplication, MatchConfidenceLevel } from './gmailApplicationMatcher.js';
import { loadJobStore, saveJobStore } from '../jobStore.js';
import { sendNotification } from '../notifications.js';
import { getResumeProfile } from '../resumeLibrary.js';

export const LIFECYCLE_STAGE_RANK = Object.freeze({
  applied: 0,
  application_confirmed: 1,
  recruiter_response: 2,
  assessment_requested: 3,
  recruiter_interview_invited: 4,
  recruiter_interview_completed: 5,
  client_interview_invited: 6,
  client_interview_completed: 7,
  offer: 8,
  hired: 9,
  rejected: 10,
  withdrawn: 11
});

export async function isGmailSyncDue(config = {}) {
  if (config.gmailSyncEnabled === false || process.env.GMAIL_SYNC_ENABLED === 'false') {
    return false;
  }

  const profileName = String(config.profileName || 'tolu').toLowerCase();
  const profileDir = config.profileDir || path.resolve(process.cwd(), 'profiles', profileName);
  const syncStatePath = path.join(profileDir, 'gmailSyncState.json');

  const intervalMs = Number.parseInt(
    config.gmailSyncIntervalMs ?? process.env.GMAIL_SYNC_INTERVAL_MS,
    10
  ) || 300000; // 5 minutes default

  const syncState = await loadSyncState(syncStatePath);
  if (!syncState.lastSyncAt) return true;

  const lastSyncTime = new Date(syncState.lastSyncAt).getTime();
  if (Number.isNaN(lastSyncTime)) return true;

  return Date.now() - lastSyncTime >= intervalMs;
}

export async function syncGmailForProfile(config = {}, options = {}) {
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
  const isInitialHistoricalSync = !syncState.lastSyncAt;
  const processedMessageIds = new Set(syncState.processedMessageIds || []);
  const processedEventKeys = new Set(syncState.processedEventKeys || []);

  // Build targeted search query based on initial vs ongoing sync
  const query = buildTargetedQuery(config, isInitialHistoricalSync);

  let searchResult;
  try {
    searchResult = await client.searchMessages(query, { maxResults: isInitialHistoricalSync ? 50 : 25 });
  } catch (err) {
    console.warn(`[gmailSync] Search failed for ${profileName}: ${err.message}`);
    return { ok: false, error: err.message };
  }

  const allFoundMessages = searchResult.messages || [];
  const messagesToFetch = allFoundMessages.filter(m => !processedMessageIds.has(m.id));
  console.log(`[gmailSync] Found ${messagesToFetch.length} new messages (out of ${allFoundMessages.length} total) for profile: ${profileName}`);

  let newEventsCount = 0;
  const globalNotificationSetting = config.gmailBackfillNotifications !== false && process.env.GMAIL_BACKFILL_NOTIFICATIONS !== 'false';
  const liveEventMaxAgeMs = 48 * 60 * 60 * 1000; // 48 hours threshold for live alerts

  for (const msgMeta of messagesToFetch) {
    try {
      const parsedEmail = await client.getMessage(msgMeta.id);
      processedMessageIds.add(msgMeta.id);

      // 1. Classify Email
      const classificationResult = await classifyEmailMessage(parsedEmail, config);
      if (classificationResult.classification === EmailEventType.UNKNOWN) {
        continue;
      }

      // 2. Match to Application
      const matchResult = await matchEmailToApplication(parsedEmail, config);

      // 3. Create Evidence Record
      const eventKey = `${profileName}:${msgMeta.id}:${classificationResult.classification}`;
      const evidence = {
        eventId: `evt_${Date.now()}_${msgMeta.id.slice(-6)}`,
        eventKey,
        gmailMessageId: msgMeta.id,
        threadId: parsedEmail.threadId,
        receivedAt: parsedEmail.receivedAt,
        sender: parsedEmail.from,
        senderEmail: parsedEmail.senderEmail,
        subject: parsedEmail.subject,
        extractedRoleTitle: parsedEmail.extractedRoleTitle || null,
        extractedJobId: parsedEmail.extractedJobId || null,
        classification: classificationResult.classification,
        classificationConfidence: classificationResult.confidence,
        classificationTier: classificationResult.tier,
        matchConfidenceLevel: matchResult.matchConfidenceLevel,
        matchConfidence: matchResult.confidence,
        matchedJobTitle: matchResult.jobRecord?.title || null,
        matchedJobHash: matchResult.jobRecord?.job_hash || null,
        matchedResumeProfile: matchResult.jobRecord?.resumeProfile || null,
        interviewDetails: classificationResult.interviewDetails || null,
        excerpt: (parsedEmail.bodyText || parsedEmail.snippet || '').slice(0, 300)
      };

      // 4. Update Application State in candidate store if matched (Monotonic Progression)
      if (matchResult.jobRecord && matchResult.matchConfidenceLevel !== MatchConfidenceLevel.UNMATCHED) {
        await updateJobLifecycleRecord(config, matchResult.jobRecord, evidence);
      }

      // 5. Send Telegram Notification only if it is a LIVE event (not historical import spam)
      const receivedAgeMs = Date.now() - new Date(parsedEmail.receivedAt).getTime();
      const isHistoricalEvent = isInitialHistoricalSync || receivedAgeMs > liveEventMaxAgeMs || options.isBackfill;

      if (!processedEventKeys.has(eventKey)) {
        processedEventKeys.add(eventKey);

        if (!isHistoricalEvent && globalNotificationSetting && !options.suppressNotifications) {
          await dispatchTelegramEvent(config, evidence, matchResult, classificationResult);
        }
      }

      newEventsCount += 1;
    } catch (err) {
      console.error(`[gmailSync] Error processing message ${msgMeta.id}:`, err.message);
    }
  }

  // Save updated sync checkpoint (keep recent 1500 IDs to bound state file)
  const updatedProcessedList = Array.from(processedMessageIds).slice(-1500);
  const updatedEventKeyList = Array.from(processedEventKeys).slice(-1500);
  await saveSyncState(syncStatePath, {
    lastSyncAt: new Date().toISOString(),
    processedMessageIds: updatedProcessedList,
    processedEventKeys: updatedEventKeyList,
    lastEventsCount: newEventsCount
  });

  return { ok: true, eventsProcessed: newEventsCount };
}

function buildTargetedQuery(config = {}, isInitialSync = false) {
  const allowedSenders = config.gmailAllowedSenders || process.env.GMAIL_ALLOWED_SENDERS || 'bruntwork, bruntwork.co, bruntwork.com';
  const sendersList = allowedSenders.split(',').map(s => s.trim()).filter(Boolean);

  const senderQuery = sendersList.length > 0
    ? `from:(${sendersList.join(' OR ')})`
    : 'from:(bruntwork OR bruntwork.co OR bruntwork.com)';

  const lookbackDays = isInitialSync
    ? (Number.parseInt(config.gmailInitialLookbackDays ?? process.env.GMAIL_INITIAL_LOOKBACK_DAYS, 10) || 180)
    : (Number.parseInt(config.gmailLiveLookbackDays ?? process.env.GMAIL_LIVE_LOOKBACK_DAYS, 10) || 7);

  return `${senderQuery} newer_than:${lookbackDays}d`;
}

export async function updateJobLifecycleRecord(config, jobRecord, evidence) {
  const store = await loadJobStore(config);
  const targetIndex = store.jobs.findIndex(j => j.job_hash === jobRecord.job_hash);

  if (targetIndex >= 0) {
    const job = store.jobs[targetIndex];
    const events = Array.isArray(job.lifecycleEvents) ? job.lifecycleEvents : [];

    if (!events.some(e => e.gmailMessageId === evidence.gmailMessageId)) {
      events.push(evidence);
    }

    const currentStatus = job.lifecycleStatus || job.status || 'applied';
    const nextStatus = resolveMonotonicLifecycleStatus(evidence.classification, currentStatus);

    // Update granular lifecycle timestamps
    const timestamps = { ...(job.lifecycleTimestamps || {}) };
    const eventTime = evidence.receivedAt || new Date().toISOString();

    if (evidence.classification === EmailEventType.APPLICATION_CONFIRMATION && !timestamps.applicationConfirmedAt) {
      timestamps.applicationConfirmedAt = eventTime;
    } else if (evidence.classification === EmailEventType.RECRUITER_RESPONSE && !timestamps.recruiterResponseAt) {
      timestamps.recruiterResponseAt = eventTime;
    } else if (evidence.classification === EmailEventType.ASSESSMENT && !timestamps.assessmentRequestedAt) {
      timestamps.assessmentRequestedAt = eventTime;
    } else if (evidence.classification === EmailEventType.RECRUITER_INTERVIEW && !timestamps.recruiterInterviewInvitedAt) {
      timestamps.recruiterInterviewInvitedAt = eventTime;
    } else if (evidence.classification === EmailEventType.CLIENT_INTERVIEW && !timestamps.clientInterviewInvitedAt) {
      timestamps.clientInterviewInvitedAt = eventTime;
    } else if (evidence.classification === EmailEventType.OFFER && !timestamps.offerAt) {
      timestamps.offerAt = eventTime;
    } else if (evidence.classification === EmailEventType.REJECTION && !timestamps.rejectedAt) {
      timestamps.rejectedAt = eventTime;
    }

    store.jobs[targetIndex] = {
      ...job,
      lifecycleStatus: nextStatus,
      lifecycleEvents: events,
      lifecycleTimestamps: timestamps,
      lastEmailEventAt: evidence.receivedAt,
      interviewDetails: evidence.interviewDetails || job.interviewDetails || null,
      updatedAt: new Date().toISOString()
    };

    await saveJobStore(config, store);
  }
}

export function resolveMonotonicLifecycleStatus(classification, currentStatus = 'applied') {
  const mappedStatus = mapClassificationToLifecycleStatus(classification, currentStatus);
  const currentRank = LIFECYCLE_STAGE_RANK[currentStatus] ?? 0;
  const newRank = LIFECYCLE_STAGE_RANK[mappedStatus] ?? 0;

  // Rejections and offers can transition from any non-terminal stage
  if (mappedStatus === 'rejected' || mappedStatus === 'offer' || mappedStatus === 'hired') {
    return mappedStatus;
  }

  // If new event is higher in funnel, advance; otherwise preserve the advanced current state
  return newRank >= currentRank ? mappedStatus : currentStatus;
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
  const jobTitle = matchResult.jobRecord?.title || evidence.extractedRoleTitle || evidence.subject;
  const company = matchResult.jobRecord?.company || 'BruntWork';
  const confidenceLevel = matchResult.matchConfidenceLevel;
  const jobId = evidence.extractedJobId || matchResult.jobRecord?.sourceJobId || null;

  // Resolve human-readable resume profile if matched
  let resumeLabel = null;
  const resumeProfileId = matchResult.jobRecord?.resumeProfile || evidence.matchedResumeProfile;
  if (resumeProfileId) {
    const resProfile = getResumeProfile(config.profileName || 'tolu', resumeProfileId);
    resumeLabel = resProfile?.title ? `${resProfile.title} (${resumeProfileId})` : resumeProfileId;
  }

  let message = '';

  if (classification === EmailEventType.CLIENT_INTERVIEW || classification === EmailEventType.RECRUITER_INTERVIEW) {
    const stage = classification === EmailEventType.CLIENT_INTERVIEW ? 'Client Interview' : 'Recruiter Interview';
    const interview = classificationResult.interviewDetails || {};

    message = `🎯 *[${candidateName}] ${stage.toUpperCase()} DETECTED*\n\n`
      + `*Role:* ${escapeMarkdown(jobTitle)}\n`
      + `*Company:* ${escapeMarkdown(company)}\n`
      + `*Stage:* ${stage}\n`
      + (jobId ? `*Job ID:* \`${escapeMarkdown(jobId)}\`\n` : '')
      + (interview.platform ? `*Platform:* ${escapeMarkdown(interview.platform)}\n` : '')
      + (interview.scheduledAt ? `*Date/Time:* ${escapeMarkdown(interview.scheduledAt)} ${interview.timezone || ''}\n` : '')
      + (interview.meetingUrl ? `*Meeting Link:* ${interview.meetingUrl}\n` : '')
      + (interview.interviewer ? `*Interviewer:* ${escapeMarkdown(interview.interviewer)}\n` : '')
      + (resumeLabel ? `*Resume:* ${escapeMarkdown(resumeLabel)}\n` : '')
      + `*Match:* ${confidenceLevel}`;
  } else if (classification === EmailEventType.OFFER) {
    message = `🎉 *[${candidateName}] JOB OFFER DETECTED*\n\n`
      + `*Role:* ${escapeMarkdown(jobTitle)}\n`
      + `*Company:* ${escapeMarkdown(company)}\n`
      + `*Stage:* Offer Received\n`
      + (jobId ? `*Job ID:* \`${escapeMarkdown(jobId)}\`\n` : '')
      + (resumeLabel ? `*Resume:* ${escapeMarkdown(resumeLabel)}\n` : '')
      + `*Subject:* ${escapeMarkdown(evidence.subject)}\n`
      + `*Match:* ${confidenceLevel}`;
  } else if (classification === EmailEventType.REJECTION) {
    message = `❌ *[${candidateName}] APPLICATION UPDATE*\n\n`
      + `*Role:* ${escapeMarkdown(jobTitle)}\n`
      + `*Company:* ${escapeMarkdown(company)}\n`
      + `*Stage:* Rejected\n`
      + (jobId ? `*Job ID:* \`${escapeMarkdown(jobId)}\`\n` : '')
      + (resumeLabel ? `*Resume:* ${escapeMarkdown(resumeLabel)}\n` : '')
      + `*Reason:* ${escapeMarkdown(evidence.excerpt.slice(0, 160))}\n`
      + `*Match:* ${confidenceLevel}`;
  } else if (classification === EmailEventType.ASSESSMENT) {
    message = `📝 *[${candidateName}] ASSESSMENT INVITATION*\n\n`
      + `*Role:* ${escapeMarkdown(jobTitle)}\n`
      + `*Company:* ${escapeMarkdown(company)}\n`
      + `*Stage:* Skills Assessment\n`
      + (jobId ? `*Job ID:* \`${escapeMarkdown(jobId)}\`\n` : '')
      + (resumeLabel ? `*Resume:* ${escapeMarkdown(resumeLabel)}\n` : '')
      + `*Subject:* ${escapeMarkdown(evidence.subject)}\n`
      + `*Match:* ${confidenceLevel}`;
  } else if (classification === EmailEventType.RECRUITER_RESPONSE || classification === EmailEventType.APPLICATION_CONFIRMATION) {
    const stage = classification === EmailEventType.APPLICATION_CONFIRMATION ? 'Application Confirmed' : 'Application Under Review';
    message = `📬 *[${candidateName}] APPLICATION UPDATE: ${stage.toUpperCase()}*\n\n`
      + `*Role:* ${escapeMarkdown(jobTitle)}\n`
      + `*Company:* ${escapeMarkdown(company)}\n`
      + `*Stage:* ${stage}\n`
      + (jobId ? `*Job ID:* \`${escapeMarkdown(jobId)}\`\n` : '')
      + (resumeLabel ? `*Resume:* ${escapeMarkdown(resumeLabel)}\n` : '')
      + `*Excerpt:* ${escapeMarkdown(evidence.excerpt.slice(0, 160))}\n`
      + `*Match:* ${confidenceLevel}`;
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
    return { processedMessageIds: [], processedEventKeys: [], lastSyncAt: null };
  }
}

async function saveSyncState(filepath, state) {
  await fs.mkdir(path.dirname(filepath), { recursive: true });
  await fs.writeFile(filepath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

/**
 * JobPilot Gmail Integration Module
 */

export { GmailAuthenticator } from './gmailAuthenticator.js';
export { GmailClient } from './gmailClient.js';
export { parseGmailMessage } from './gmailMessageParser.js';
export { classifyEmailMessage, classifyDeterministic, EmailEventType, extractInterviewDetails } from './gmailClassifier.js';
export { matchEmailToApplication, MatchConfidenceLevel } from './gmailApplicationMatcher.js';
export { syncGmailForProfile } from './gmailSync.js';

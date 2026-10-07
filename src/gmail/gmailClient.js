/**
 * Gmail REST API Client
 *
 * Lightweight, direct HTTPS client using native fetch and minimal read-only operations.
 */

import { GmailAuthenticator } from './gmailAuthenticator.js';
import { parseGmailMessage } from './gmailMessageParser.js';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export class GmailClient {
  constructor(config = {}) {
    this.config = config;
    this.authenticator = new GmailAuthenticator(config);
  }

  async isConfigured() {
    return this.authenticator.isConfigured();
  }

  async getAccessToken() {
    return this.authenticator.getValidAccessToken();
  }

  /**
   * Search for messages matching a targeted query
   */
  async searchMessages(query, options = {}) {
    const accessToken = await this.getAccessToken();
    const maxResults = options.maxResults || 20;

    const params = new URLSearchParams({
      q: query,
      maxResults: String(maxResults)
    });

    if (options.pageToken) {
      params.set('pageToken', options.pageToken);
    }

    const response = await fetch(`${GMAIL_API_BASE}/messages?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Gmail search error (${response.status}): ${data.error?.message || response.statusText}`);
    }

    return {
      messages: data.messages || [],
      nextPageToken: data.nextPageToken || null,
      resultSizeEstimate: data.resultSizeEstimate || 0
    };
  }

  /**
   * Get full message details by ID
   */
  async getMessage(messageId) {
    const accessToken = await this.getAccessToken();

    const response = await fetch(`${GMAIL_API_BASE}/messages/${messageId}?format=full`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Gmail getMessage error (${response.status}): ${data.error?.message || response.statusText}`);
    }

    return parseGmailMessage(data);
  }

  /**
   * Incremental sync using Gmail history API
   */
  async getHistory(startHistoryId, options = {}) {
    const accessToken = await this.getAccessToken();
    const params = new URLSearchParams({
      startHistoryId: String(startHistoryId),
      maxResults: String(options.maxResults || 50)
    });

    if (options.historyTypes) {
      params.set('historyTypes', options.historyTypes);
    }

    const response = await fetch(`${GMAIL_API_BASE}/history?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });

    const data = await response.json();
    if (!response.ok) {
      // If historyId is too old (404 / 400), signal to fallback to targeted search
      return {
        ok: false,
        staleHistoryId: true,
        error: data.error?.message || response.statusText
      };
    }

    return {
      ok: true,
      history: data.history || [],
      historyId: data.historyId,
      nextPageToken: data.nextPageToken || null
    };
  }

  /**
   * Get candidate's Gmail user profile info
   */
  async getProfile() {
    const accessToken = await this.getAccessToken();
    const response = await fetch(`${GMAIL_API_BASE}/profile`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(`Gmail getProfile error: ${data.error?.message || response.statusText}`);
    }

    return data;
  }
}

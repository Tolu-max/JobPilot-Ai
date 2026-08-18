/**
 * Gmail OAuth 2.0 Authenticator
 *
 * Implements standard Google OAuth 2.0 authorization code grant and token refresh
 * using native fetch. Minimum required read-only scope is requested.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export class GmailAuthenticator {
  constructor(config = {}) {
    this.config = config;
    this.profileName = String(config.profileName || 'tolu').toLowerCase();
    this.profileDir = config.profileDir || path.resolve(process.cwd(), 'profiles', this.profileName);
    this.tokenFilePath = path.join(this.profileDir, 'gmailToken.json');
    this.cachedAccessToken = null;
    this.tokenExpiresAt = 0;
  }

  /**
   * Resolve OAuth Client ID & Secret from environment or profile preferences
   */
  getCredentials() {
    const envPrefix = this.profileName.toUpperCase();
    const clientId = process.env[`${envPrefix}_GMAIL_CLIENT_ID`]
      || process.env.GMAIL_CLIENT_ID
      || this.config.preferences?.gmail?.clientId
      || '';

    const clientSecret = process.env[`${envPrefix}_GMAIL_CLIENT_SECRET`]
      || process.env.GMAIL_CLIENT_SECRET
      || this.config.preferences?.gmail?.clientSecret
      || '';

    const directRefreshToken = process.env[`${envPrefix}_GMAIL_REFRESH_TOKEN`]
      || process.env.GMAIL_REFRESH_TOKEN
      || this.config.preferences?.gmail?.refreshToken
      || '';

    return { clientId, clientSecret, directRefreshToken };
  }

  /**
   * Check whether Gmail OAuth is configured for this profile
   */
  isConfigured() {
    const { clientId, clientSecret } = this.getCredentials();
    return Boolean(clientId && clientSecret);
  }

  /**
   * Generates the Google OAuth 2.0 authorization URL
   */
  getAuthorizationUrl(redirectUri, state = '') {
    const { clientId } = this.getCredentials();
    if (!clientId) {
      throw new Error(`Gmail Client ID not configured for profile: ${this.profileName}`);
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GMAIL_READONLY_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      state: state || this.profileName
    });

    return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
  }

  /**
   * Exchanges an authorization code for tokens
   */
  async exchangeCodeForTokens(code, redirectUri) {
    const { clientId, clientSecret } = this.getCredentials();
    if (!clientId || !clientSecret) {
      throw new Error(`Gmail Client ID/Secret missing for profile: ${this.profileName}`);
    }

    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(`Google token exchange failed: ${data.error_description || data.error || response.statusText}`);
    }

    await this.saveTokens(data);
    return data;
  }

  /**
   * Persists OAuth token data securely to the candidate's profile directory
   */
  async saveTokens(tokenData) {
    await fs.mkdir(path.dirname(this.tokenFilePath), { recursive: true });
    const payload = {
      ...tokenData,
      profile: this.profileName,
      updatedAt: new Date().toISOString()
    };
    await fs.writeFile(this.tokenFilePath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600
    });
    try {
      await fs.chmod(this.tokenFilePath, 0o600);
    } catch {
      // POSIX chmod fallback
    }
    if (tokenData.access_token) {
      this.cachedAccessToken = tokenData.access_token;
      this.tokenExpiresAt = Date.now() + ((tokenData.expires_in || 3600) * 1000) - 60000;
    }
  }

  /**
   * Load stored token data from file or environment
   */
  async loadTokens() {
    const { directRefreshToken } = this.getCredentials();
    if (directRefreshToken) {
      return { refresh_token: directRefreshToken, source: 'environment' };
    }

    try {
      const raw = await fs.readFile(this.tokenFilePath, 'utf8');
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Get a valid, fresh access token (refreshes automatically if expired)
   */
  async getValidAccessToken() {
    if (this.cachedAccessToken && Date.now() < this.tokenExpiresAt) {
      return this.cachedAccessToken;
    }

    const tokens = await this.loadTokens();
    const refreshToken = tokens?.refresh_token;

    if (!refreshToken) {
      throw new Error(`No Gmail refresh token available for profile: ${this.profileName}. Run: jobpilot gmail auth --profile=${this.profileName}`);
    }

    const { clientId, clientSecret } = this.getCredentials();
    if (!clientId || !clientSecret) {
      throw new Error(`Gmail credentials missing for profile: ${this.profileName}`);
    }

    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
      })
    });

    const data = await response.json();
    if (!response.ok || data.error) {
      throw new Error(`Failed to refresh Gmail access token: ${data.error_description || data.error || response.statusText}`);
    }

    this.cachedAccessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + ((data.expires_in || 3600) * 1000) - 60000;

    // Update stored tokens if a new refresh token was issued
    if (data.refresh_token) {
      await this.saveTokens({ ...tokens, ...data });
    }

    return this.cachedAccessToken;
  }
}

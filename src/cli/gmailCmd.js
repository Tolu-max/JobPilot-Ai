/**
 * CLI Command: Gmail OAuth Setup & Sync
 */

import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import pc from 'picocolors';
import { buildConfig } from '../config.js';
import { GmailAuthenticator } from '../gmail/gmailAuthenticator.js';
import { syncGmailForProfile } from '../gmail/gmailSync.js';
import {
  printSectionHeader,
  printInfo,
  printSuccess,
  printWarn,
  printError,
  printHint,
  printBox,
  createSpinner
} from './banner.js';

export async function cmdGmail(args = {}) {
  const profileName = args.profile || args.p || 'tolu';
  const config = buildConfig([process.execPath, 'jobpilot', `--profile=${profileName}`]);
  const action = args._?.[0] || args.action || 'auth';

  if (action === 'sync') {
    printSectionHeader(`Gmail Sync — ${profileName}`);
    const spin = createSpinner(`Syncing Gmail for profile: ${profileName}`).start();
    try {
      const res = await syncGmailForProfile(config);
      spin.stop();
      if (res.skipped) {
        printWarn(res.reason);
      } else if (res.ok) {
        printSuccess(`Gmail sync completed: ${res.eventsProcessed} new event(s) processed.`);
      } else {
        printError(`Gmail sync failed: ${res.error}`);
      }
    } catch (err) {
      spin.stop();
      printError(`Sync error: ${err.message}`);
    }
    return;
  }

  // Auth flow
  await runGmailOAuthFlow(config);
}

async function runGmailOAuthFlow(config) {
  const profileName = config.profileName || 'tolu';
  printSectionHeader(`Gmail Authorization — ${profileName}`);

  const authenticator = new GmailAuthenticator(config);
  const { clientId, clientSecret } = authenticator.getCredentials();

  if (!clientId || !clientSecret) {
    printWarn(`Google OAuth Client ID & Secret are not configured for profile: ${profileName}`);
    console.log();
    printBox([
      `${pc.white('To enable Gmail integration:')}`,
      `1. Create a Project in Google Cloud Console (${pc.cyan('https://console.cloud.google.com')})`,
      `2. Enable the ${pc.bold('Gmail API')}.`,
      `3. Create an ${pc.bold('OAuth 2.0 Client ID')} (Application type: Desktop App or Web App).`,
      `4. Set redirect URI to: ${pc.cyan('http://127.0.0.1:8089/callback')}`,
      `5. Add environment variables:`,
      `   ${pc.yellow('GMAIL_CLIENT_ID')}="your-client-id"`,
      `   ${pc.yellow('GMAIL_CLIENT_SECRET')}="your-client-secret"`,
      `   or for candidate specific:`,
      `   ${pc.yellow(`${profileName.toUpperCase()}_GMAIL_CLIENT_ID`)}="your-client-id"`,
      `   ${pc.yellow(`${profileName.toUpperCase()}_GMAIL_CLIENT_SECRET`)}="your-client-secret"`
    ], { title: 'Google OAuth Setup Guide' });
    return;
  }

  printInfo(`Starting local authentication loopback server on port 8089...\n`);
  const redirectUri = 'http://127.0.0.1:8089/callback';
  const authUrl = authenticator.getAuthorizationUrl(redirectUri);

  const server = http.createServer();
  return new Promise((resolve) => {
    server.listen(8089, '127.0.0.1', async () => {
      printInfo(`Open the following URL in your browser to authorize Gmail access:`);
      console.log(`\n  ${pc.cyan(authUrl)}\n`);
      printHint(`Waiting for Google OAuth authorization callback... (Press Ctrl+C to cancel)\n`);

      try {
        const open = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        const { exec } = await import('node:child_process');
        exec(`${open} "${authUrl}"`, { windowsHide: true });
      } catch {
        /* User opens manually */
      }

      server.on('request', async (req, res) => {
        const parsedUrl = new URL(req.url, 'http://127.0.0.1:8089');
        if (parsedUrl.pathname === '/callback') {
          const code = parsedUrl.searchParams.get('code');
          const error = parsedUrl.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`<h2>Authorization Failed</h2><p>${error}</p>`);
            printError(`Google Authorization returned error: ${error}`);
            server.close();
            resolve();
            return;
          }

          if (code) {
            try {
              const tokenData = await authenticator.exchangeCodeForTokens(code, redirectUri);
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end(`<h2>JobPilot Gmail Connected!</h2><p>You can close this tab and return to the terminal.</p>`);

              console.log();
              printSuccess(`Gmail authorization successful for candidate: ${profileName}`);
              printInfo(`Tokens securely saved to: ${authenticator.tokenFilePath}`);
              console.log();
              printBox([
                `${pc.white('Security & Persistence:')}`,
                `• Tokens are saved with restricted permissions in:`,
                `  ${pc.cyan(authenticator.tokenFilePath)}`,
                `• In Railway with volume storage (/app/data/profiles), tokens persist automatically.`,
                `• If using environment variables, configure ${pc.yellow(`${profileName.toUpperCase()}_GMAIL_REFRESH_TOKEN`)} securely in Railway settings.`
              ], { title: 'Gmail Authorization Complete' });

              server.close(() => resolve());
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'text/html' });
              res.end(`<h2>Token Exchange Failed</h2><p>${err.message}</p>`);
              printError(`Token exchange failed: ${err.message}`);
              server.close(() => resolve());
            }
          }
        }
      });
    });
  });
}

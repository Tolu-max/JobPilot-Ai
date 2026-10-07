import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ApplicationOutcome, ApplicationState } from '../src/applicationStateManager.js';
import { attemptApplication } from '../src/automation.js';

const RUN_BROWSER_TESTS = process.env.RUN_BROWSER_TESTS === '1';

test('TEST_MODE fills form, creates debug artifacts, and stops before submit', { skip: !RUN_BROWSER_TESTS }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-agent-'));
  const htmlPath = path.join(dir, 'form.html');
  const resumePath = path.join(dir, 'resume.pdf');
  const debugRootDir = path.join(dir, 'debug');
  const browserProfileDir = path.join(dir, 'browser-profile');

  await fs.writeFile(
    htmlPath,
    `<html><body>
      <form>
        <input type="email" name="email" />
        <input type="file" name="resume" />
        <textarea name="cover"></textarea>
        <button type="submit">Submit Application</button>
      </form>
    </body></html>`,
    'utf8'
  );
  await fs.writeFile(resumePath, 'fake pdf');

  const result = await attemptApplication(
    {
      title: 'Website Administrator',
      applicationUrl: pathToFileURL(htmlPath).toString()
    },
    'Short cover letter.',
    {
      applicantEmail: 'test@example.com',
      resumePath,
      browserProfileDir,
      debugRootDir,
      rootDir: dir,
      headless: true,
      testMode: true,
      minDelayMs: 1,
      maxDelayMs: 1
    }
  );

  assert.equal(result.outcome, ApplicationOutcome.REQUIRES_MANUAL_REVIEW);
  assert.equal(result.finalState, ApplicationState.NEEDS_MANUAL_REVIEW);
  assert.match(result.reason, /TEST_MODE=true/);

  const files = await fs.readdir(result.debugDir);
  assert.equal(files.includes('screenshot_before_submit.png'), true);
  assert.equal(files.includes('screenshot_after_submit.png'), true);
  assert.equal(files.includes('page_html_after_submit.html'), true);
  assert.equal(files.includes('console_logs.txt'), true);
  assert.equal(files.includes('application_lifecycle.json'), true);
});

test('NO_REAL_SUBMISSION also stops before submit', { skip: !RUN_BROWSER_TESTS }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'job-agent-'));
  const htmlPath = path.join(dir, 'form.html');
  const resumePath = path.join(dir, 'resume.pdf');

  await fs.writeFile(
    htmlPath,
    `<html><body>
      <form>
        <input type="email" name="email" />
        <input type="file" name="resume" />
        <textarea name="cover"></textarea>
        <button type="submit">Submit Application</button>
      </form>
    </body></html>`,
    'utf8'
  );
  await fs.writeFile(resumePath, 'fake pdf');

  const result = await attemptApplication(
    {
      title: 'Website Administrator',
      applicationUrl: pathToFileURL(htmlPath).toString()
    },
    'Short cover letter.',
    {
      applicantEmail: 'test@example.com',
      resumePath,
      browserProfileDir: path.join(dir, 'browser-profile'),
      debugRootDir: path.join(dir, 'debug'),
      rootDir: dir,
      headless: true,
      noRealSubmission: true,
      minDelayMs: 1,
      maxDelayMs: 1
    }
  );

  assert.equal(result.outcome, ApplicationOutcome.REQUIRES_MANUAL_REVIEW);
  assert.equal(result.finalState, ApplicationState.NEEDS_MANUAL_REVIEW);
  assert.match(result.reason, /NO_REAL_SUBMISSION=true/);
});

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';

const VERSION = 'v2026-06-03-3';

export async function bootstrapProfilesFromEnv({ rootDir = process.cwd(), logger = console } = {}) {
  if (process.env.JOBPILOT_PROFILE_BOOTSTRAPPED === '1') return { skipped: true, reason: 'entrypoint' };

  const bundleUrl = process.env.PROFILE_BUNDLE_URL;
  const railwayLike = isRailwayLikeRuntime(rootDir);
  if (!bundleUrl && !railwayLike) return { skipped: true, reason: 'not-configured' };

  logger.log(`[bootstrap] JobPilot Node profile bootstrap ${VERSION}`);

  const dataDir = process.env.JOBPILOT_DATA_DIR || (railwayLike ? '/app/data' : path.join(rootDir, 'data'));
  ensureVolumeDirs(dataDir);

  if (railwayLike) {
    linkVolumeDirs(rootDir, dataDir, logger);
  }

  if (bundleUrl) {
    const archivePath = path.join(tempDir(), 'jobpilot-profile-bundle');
    logger.log('[bootstrap] PROFILE_BUNDLE_URL is set. Downloading profiles bundle...');
    await download(bundleUrl, archivePath);
    await validateAndExtract(archivePath, dataDir, logger);
    fs.rmSync(archivePath, { force: true });
  } else {
    logger.log('[bootstrap] PROFILE_BUNDLE_URL is not set; using existing Railway volume profiles.');
  }

  logProfileFiles(path.join(dataDir, 'profiles'), logger);
  warnMissingResumes(path.join(dataDir, 'profiles'), logger);

  return { skipped: false, dataDir };
}

function isRailwayLikeRuntime(rootDir) {
  return Boolean(
    process.env.RAILWAY_ENVIRONMENT ||
    process.env.RAILWAY_PROJECT_ID ||
    process.env.RAILWAY_SERVICE_ID ||
    path.resolve(rootDir) === '/app'
  );
}

function ensureVolumeDirs(dataDir) {
  for (const name of ['profiles', 'logs', 'review', 'debug', 'browser-profiles', 'test-results']) {
    fs.mkdirSync(path.join(dataDir, name), { recursive: true });
  }
}

function linkVolumeDirs(rootDir, dataDir, logger) {
  for (const name of ['profiles', 'logs', 'review', 'debug', 'browser-profiles', 'test-results']) {
    const source = path.join(rootDir, name);
    const target = path.join(dataDir, name);

    if (name === 'profiles') copyExampleProfile(source, target);

    try {
      const current = fs.lstatSync(source);
      if (current.isSymbolicLink()) {
        fs.rmSync(source, { force: true });
      } else {
        fs.rmSync(source, { recursive: true, force: true });
      }
    } catch {
      // Missing source is fine; it will be linked below.
    }

    fs.symlinkSync(target, source, 'dir');
    logger.log(`[bootstrap] Linked ${source} -> ${target}`);
  }
}

function copyExampleProfile(source, target) {
  const sourceExample = path.join(source, 'example');
  const targetExample = path.join(target, 'example');
  if (!fs.existsSync(sourceExample) || fs.existsSync(targetExample)) return;
  fs.cpSync(sourceExample, targetExample, { recursive: true });
}

async function download(targetUrl, filePath, redirects = 0) {
  if (redirects > 5) throw new Error('Too many redirects while downloading profile bundle.');

  await new Promise((resolve, reject) => {
    const client = targetUrl.startsWith('https:') ? https : http;
    const request = client.get(targetUrl, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        const nextUrl = new URL(response.headers.location, targetUrl).toString();
        download(nextUrl, filePath, redirects + 1).then(resolve, reject);
        return;
      }

      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(filePath);
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });

    request.on('error', reject);
  });

  validateDownloadedFile(filePath);
}

function validateDownloadedFile(filePath) {
  const stat = fs.statSync(filePath);
  const header = readHeader(filePath);
  const firstBytes = [...header].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
  console.log(`[bootstrap] Downloaded profile bundle (${stat.size} bytes, first bytes: ${firstBytes}).`);

  if (stat.size < 128) {
    throw new Error('Downloaded profile bundle is too small. Check PROFILE_BUNDLE_URL access permissions.');
  }

  if (header.toString('utf8').trimStart().startsWith('<')) {
    throw new Error('Downloaded profile bundle looks like HTML, not an archive. Use a direct download link or another file host.');
  }
}

async function validateAndExtract(archivePath, dataDir, logger) {
  const format = normalizeFormat(process.env.PROFILE_BUNDLE_FORMAT || 'tar.gz');
  const header = readHeader(archivePath);

  logger.log(`[bootstrap] Extracting profile bundle as ${format}...`);

  if (format === 'zip') {
    if (!isZip(header)) throw new Error('PROFILE_BUNDLE_FORMAT=zip but downloaded file is not a zip archive.');
    await run('unzip', ['-t', archivePath], 'PROFILE_BUNDLE_FORMAT=zip requires unzip in the runtime.');
    await run('unzip', ['-o', archivePath, '-d', dataDir], 'PROFILE_BUNDLE_FORMAT=zip requires unzip in the runtime.');
    return;
  }

  if (!isGzip(header)) throw new Error('PROFILE_BUNDLE_FORMAT=tar.gz but downloaded file is not a gzip archive.');
  await run('gzip', ['-t', archivePath], 'gzip is required to validate tar.gz profile bundles.');
  await run('tar', ['-xzf', archivePath, '-C', dataDir], 'tar is required to extract tar.gz profile bundles.');
}

function normalizeFormat(format) {
  const value = String(format || '').trim().toLowerCase();
  if (value === 'zip') return 'zip';
  if (value === 'tgz' || value === 'tar.gz') return 'tar.gz';
  throw new Error(`Unsupported PROFILE_BUNDLE_FORMAT "${format}". Use tar.gz or zip.`);
}

function readHeader(filePath) {
  const header = Buffer.alloc(16);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, header, 0, header.length, 0);
  fs.closeSync(fd);
  return header;
}

function isGzip(header) {
  return header[0] === 0x1f && header[1] === 0x8b;
}

function isZip(header) {
  return header[0] === 0x50 && header[1] === 0x4b;
}

function run(command, args, missingMessage) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', () => reject(new Error(missingMessage)));
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed with exit code ${code}.`));
    });
  });
}

function tempDir() {
  return process.env.TMPDIR || process.env.TEMP || process.env.TMP || '/tmp';
}

function logProfileFiles(profilesDir, logger) {
  logger.log('[bootstrap] Profile files:');
  const files = listFiles(profilesDir, 2);
  if (!files.length) {
    logger.log('  (none - check bundle structure)');
    return;
  }
  for (const file of files) logger.log(`  ${file}`);
}

function listFiles(dir, maxDepth, depth = 0) {
  if (depth > maxDepth || !fs.existsSync(dir)) return [];

  const results = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      results.push(...listFiles(fullPath, maxDepth, depth + 1));
    } else if (item.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

function warnMissingResumes(profilesDir, logger) {
  for (const profile of requestedProfiles()) {
    const resumePath = path.join(profilesDir, profile, 'resume.pdf');
    if (profile !== 'example' && !fs.existsSync(resumePath)) {
      logger.warn(`[bootstrap] Warning: ${resumePath} is missing.`);
    }
  }
}

function requestedProfiles() {
  return String(process.env.PROFILES || process.env.PROFILE || '')
    .split(',')
    .map((profile) => profile.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, ''))
    .filter(Boolean);
}

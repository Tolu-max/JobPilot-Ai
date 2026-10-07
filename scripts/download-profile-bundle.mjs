import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const [, , url, outputPath] = process.argv;

if (!url || !outputPath) {
  console.error('Usage: node scripts/download-profile-bundle.mjs <url> <output-path>');
  process.exit(1);
}

await download(url, outputPath);

const stat = fs.statSync(outputPath);
const header = Buffer.alloc(16);
const fd = fs.openSync(outputPath, 'r');
fs.readSync(fd, header, 0, header.length, 0);
fs.closeSync(fd);

const firstBytes = [...header].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
console.log(`[bootstrap] Downloaded profile bundle (${stat.size} bytes, first bytes: ${firstBytes}).`);

if (stat.size < 128) {
  throw new Error('Downloaded profile bundle is too small. Check PROFILE_BUNDLE_URL access permissions.');
}

const startsWithHtml = header.toString('utf8').trimStart().startsWith('<');
if (startsWithHtml) {
  throw new Error('Downloaded profile bundle looks like HTML, not an archive. Google Drive may be returning a preview/login page; use a direct download link or another file host.');
}

function download(targetUrl, filePath, redirects = 0) {
  if (redirects > 5) {
    return Promise.reject(new Error('Too many redirects while downloading profile bundle.'));
  }

  return new Promise((resolve, reject) => {
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
}

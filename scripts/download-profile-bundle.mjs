import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const [, , url, outputPath] = process.argv;

if (!url || !outputPath) {
  console.error('Usage: node scripts/download-profile-bundle.mjs <url> <output-path>');
  process.exit(1);
}

await download(url, outputPath);

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

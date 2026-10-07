const fs = require('fs');
const https = require('https');

const SUPABASE_URL = 'ncwpvvbdgvcnmgjfxfrw.supabase.co';
const SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jd3B2dmJkZ3Zjbm1namZ4ZnJ3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTg3NTA5NiwiZXhwIjoyMDk1NDUxMDk2fQ.Q9GjqgIOJr0sy8jEjwCM8DTDTA8Kf6BurODXnIv4j0k';
const BUCKET = 'profiles-bundle';
const FILE_NAME = 'profiles-bundle.tar.gz';

const fileData = fs.readFileSync(FILE_NAME);

// Step 1: Create bucket (ignore if exists)
function makeRequest(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: SUPABASE_URL,
      path,
      method,
      headers: {
        'Authorization': 'Bearer ' + SERVICE_ROLE_KEY,
        'apikey': SERVICE_ROLE_KEY,
        ...headers
      }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function run() {
  // Create bucket with public access
  console.log('Creating bucket...');
  const bucketRes = await makeRequest('POST', '/storage/v1/bucket', {
    'Content-Type': 'application/json'
  }, JSON.stringify({ id: BUCKET, name: BUCKET, public: true }));
  console.log('Bucket:', bucketRes.status, bucketRes.body.slice(0, 100));

  // Upload file
  console.log('Uploading file...');
  const uploadRes = await makeRequest(
    'POST',
    '/storage/v1/object/' + BUCKET + '/' + FILE_NAME,
    {
      'Content-Type': 'application/gzip',
      'Content-Length': fileData.length
    },
    fileData
  );
  console.log('Upload:', uploadRes.status, uploadRes.body.slice(0, 200));

  if (uploadRes.status === 200 || uploadRes.status === 201) {
    const publicUrl = 'https://' + SUPABASE_URL + '/storage/v1/object/public/' + BUCKET + '/' + FILE_NAME;
    console.log('\n=== SUCCESS ===');
    console.log('Public URL:', publicUrl);
  } else {
    console.error('Upload failed.');
  }
}

run().catch(console.error);

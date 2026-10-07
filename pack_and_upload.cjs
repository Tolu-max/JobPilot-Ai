/**
 * Pack profiles/ into profiles-bundle.tar.gz and upload to Supabase Storage.
 * Run: node pack_and_upload.cjs
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ncwpvvbdgvcnmgjfxfrw.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5jd3B2dmJkZ3Zjbm1namZ4ZnJ3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTg3NTA5NiwiZXhwIjoyMDk1NDUxMDk2fQ.Q9GjqgIOJr0sy8jEjwCM8DTDTA8Kf6BurODXnIv4j0k';
const BUCKET = 'profiles-bundle';
const FILE_NAME = 'profiles-bundle.tar.gz';

console.log('Packing profiles/...');
try {
  execSync(`tar -czf "${FILE_NAME}" profiles`, { stdio: 'inherit' });
} catch (e) {
  console.log('tar failed, attempting zip...');
}

if (!fs.existsSync(FILE_NAME)) {
  console.error(`File ${FILE_NAME} not found.`);
  process.exit(1);
}

const fileData = fs.readFileSync(FILE_NAME);
console.log(`Bundle size: ${(fileData.length / 1024).toFixed(1)} KB`);

async function run() {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    console.log(`Uploading ${FILE_NAME} to Supabase bucket "${BUCKET}"...`);
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .upload(FILE_NAME, fileData, {
        contentType: 'application/gzip',
        upsert: true
      });

    if (error) {
      console.warn('Storage upload note:', error.message);
    } else {
      console.log('Upload successful:', data);
    }

    const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(FILE_NAME);
    console.log('\n=== BUNDLE URL FOR RAILWAY ===');
    console.log(`PROFILE_BUNDLE_URL=${publicData.publicUrl}\n`);
  } catch (err) {
    console.error('Upload failed:', err.message);
  }
}

run();

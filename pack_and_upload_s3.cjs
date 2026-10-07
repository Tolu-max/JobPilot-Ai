/**
 * Pack profiles/ into profiles-bundle.tar.gz and upload to AWS S3.
 * Usage: node pack_and_upload_s3.cjs [bucket-name] [region]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const bucket = process.argv[2] || process.env.AWS_S3_BUCKET || 'jobpilot-profiles';
const region = process.argv[3] || process.env.AWS_REGION || 'us-east-1';
const fileName = 'profiles-bundle.tar.gz';

console.log('=== Packing Profiles for AWS Deployment ===\n');

try {
  // Check if tar exists
  console.log('Archiving profiles directory...');
  execSync(`tar -czf "${fileName}" profiles`, { stdio: 'inherit' });
  const stat = fs.statSync(fileName);
  console.log(`Archive created: ${fileName} (${(stat.size / 1024).toFixed(1)} KB)`);

  console.log(`\nUploading to S3 bucket: s3://${bucket}/${fileName}...`);
  execSync(`aws s3 cp "${fileName}" "s3://${bucket}/${fileName}" --region ${region}`, { stdio: 'inherit' });

  // Generate 7-day presigned URL or direct URL
  const presignedUrl = execSync(
    `aws s3 presign "s3://${bucket}/${fileName}" --expires-in 604800 --region ${region}`,
    { encoding: 'utf8' }
  ).trim();

  console.log('\n=== Upload Complete ===');
  console.log('Set this environment variable in AWS ECS / App Runner:');
  console.log(`PROFILE_BUNDLE_URL="${presignedUrl}"\n`);
} catch (err) {
  console.error('\nError packing or uploading to S3:', err.message);
  console.log('Tip: Ensure AWS CLI is configured with "aws configure" and the S3 bucket exists.');
}

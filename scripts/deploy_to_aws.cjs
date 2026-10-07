#!/usr/bin/env node
/**
 * JobPilot AWS Deployment Helper
 * Usage: node scripts/deploy_to_aws.cjs [--region=us-east-1] [--account=<aws_account_id>]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
let accountId = process.env.AWS_ACCOUNT_ID;

console.log('=== JobPilot AWS Deployment ===\n');

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

function runCapture(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

async function main() {
  // 1. Check AWS CLI
  try {
    const awsVersion = runCapture('aws --version');
    console.log(`Found AWS CLI: ${awsVersion}`);
  } catch (err) {
    console.error('Error: AWS CLI is not installed or not in PATH.');
    console.error('Install AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html');
    process.exit(1);
  }

  // 2. Fetch Account ID if not set
  if (!accountId) {
    try {
      accountId = runCapture('aws sts get-caller-identity --query Account --output text');
      console.log(`Detected AWS Account ID: ${accountId}`);
    } catch (err) {
      console.error('Error getting AWS Account ID. Ensure you have run "aws configure" with valid credentials.');
      process.exit(1);
    }
  }

  const repoName = 'jobpilot-runner';
  const ecrUri = `${accountId}.dkr.ecr.${region}.amazonaws.com/${repoName}`;

  // 3. Create ECR Repo if it doesn't exist
  console.log(`\nVerifying ECR Repository "${repoName}" in ${region}...`);
  try {
    runCapture(`aws ecr describe-repositories --repository-names ${repoName} --region ${region}`);
    console.log('ECR Repository exists.');
  } catch (err) {
    console.log('Creating ECR Repository...');
    run(`aws ecr create-repository --repository-name ${repoName} --region ${region}`);
  }

  // 4. Authenticate Docker with ECR
  console.log('\nAuthenticating Docker to Amazon ECR...');
  try {
    run(`aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${accountId}.dkr.ecr.${region}.amazonaws.com`);
  } catch (err) {
    console.error('Docker login failed. Ensure Docker Desktop / daemon is running.');
    process.exit(1);
  }

  // 5. Build Docker image
  console.log('\nBuilding JobPilot Docker image...');
  run(`docker build -t ${repoName}:latest -f Dockerfile .`);

  // 6. Tag Docker image
  console.log(`\nTagging image as ${ecrUri}:latest...`);
  run(`docker tag ${repoName}:latest ${ecrUri}:latest`);

  // 7. Push to ECR
  console.log(`\nPushing Docker image to ECR...`);
  run(`docker push ${ecrUri}:latest`);

  console.log('\n=== Image Successfully Pushed to AWS ECR ===');
  console.log(`URI: ${ecrUri}:latest\n`);
  console.log('Next steps:');
  console.log('1. Deploy with CloudFormation: aws cloudformation deploy --template-file aws/cloudformation.yaml --stack-name jobpilot --capabilities CAPABILITY_NAMED_IAM');
  console.log('2. Or deploy on AWS App Runner / Lightsail / ECS Fargate using the ECR image URI.');
}

main().catch((err) => {
  console.error('Deployment error:', err.message);
  process.exit(1);
});

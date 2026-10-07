import { execSync } from 'node:child_process';

const script = process.argv[2] || 'scripts/ops/verify-ec2.mjs';

console.log(`Uploading ${script} to EC2...`);
execSync(`scp -B -i C:/Users/USA/.ssh/aws-ec2.pem -o StrictHostKeyChecking=no "${script}" "ubuntu@13.60.173.41:/home/ubuntu/jobpilot/${script}"`, { stdio: 'inherit' });

console.log(`Executing ${script} on EC2...`);
execSync(`ssh -n -i C:/Users/USA/.ssh/aws-ec2.pem -o BatchMode=yes -o StrictHostKeyChecking=no ubuntu@13.60.173.41 "cd /home/ubuntu/jobpilot ; node ${script}"`, { stdio: 'inherit' });

# Deploying JobPilot to AWS (Migrated from Railway)

This guide explains how to deploy JobPilot's automated job scraper and scheduler to Amazon Web Services (AWS) instead of Railway.

---

## 🏗️ Architecture Options on AWS

| Method | Best For | Cost Estimate | Complexity |
| :--- | :--- | :--- | :--- |
| **AWS App Runner** | Managed container service (similar to Railway) | ~$5–$15 / mo | ⭐ Low |
| **AWS ECS on Fargate** | Enterprise serverless task runner with CloudWatch logs | ~$10–$25 / mo | ⭐⭐ Medium |
| **AWS EC2 / Lightsail** | Dedicated VM running Node/PM2 or Docker directly | ~$3.50–$10 / mo | ⭐ Low |

---

## 📦 Prerequisites

1. **AWS CLI** installed and configured:
   ```bash
   aws configure
   ```
2. **Docker Desktop** installed (if building container images locally).

---

## 🚀 Option 1: Fast Deploy with Automated Helper (`deploy_to_aws.cjs`)

We have created an automated deployment helper at `scripts/deploy_to_aws.cjs`.

### Step 1: Pack & Upload Profiles (Optional / Cloud Volume)
If you want to sync your candidate profiles to S3:
```bash
node pack_and_upload_s3.cjs <your-s3-bucket-name>
```
*This generates a secure `PROFILE_BUNDLE_URL` for your container.*

### Step 2: Build & Push Container to AWS ECR
```bash
node scripts/deploy_to_aws.cjs
```
This script will:
1. Detect your AWS Account ID & Region.
2. Create the `jobpilot-runner` ECR repository if needed.
3. Authenticate Docker with Amazon ECR.
4. Build the multi-platform Playwright/Chromium container.
5. Push the image to `<account_id>.dkr.ecr.<region>.amazonaws.com/jobpilot-runner:latest`.

---

## ☁️ Option 2: Deploy to AWS ECS Fargate via CloudFormation

Use the ready-made template in `aws/cloudformation.yaml`:

```bash
aws cloudformation deploy \
  --template-file aws/cloudformation.yaml \
  --stack-name jobpilot-stack \
  --parameter-overrides \
      Profiles="tolu,sister" \
      ProfileBundleUrl="<YOUR_S3_OR_SUPABASE_BUNDLE_URL>" \
  --capabilities CAPABILITY_NAMED_IAM
```

---

## 🏃 Option 3: Deploy via AWS App Runner (Fastest Managed Container)

1. Open **AWS App Runner Console** → **Create service**.
2. Source: **Container registry** → **Amazon ECR**.
3. Select repository: `jobpilot-runner:latest`.
4. Deployment trigger: **Automatic** (or Manual).
5. Environment Variables:
   - `NODE_ENV` = `production`
   - `HEADLESS` = `true`
   - `PROFILES` = `tolu,sister`
   - `AI_PROVIDER` = `deepseek` (or `gemini` / `openrouter`)
   - `DEEPSEEK_API_KEY` = `<your_key>`
   - `TELEGRAM_BOT_TOKEN` = `<your_token>`
   - `TELEGRAM_CHAT_ID` = `<your_chat_id>`
   - `JOBPILOT_CLOUD_RUNTIME` = `aws`
   - `PROFILE_BUNDLE_URL` = `<your_bundle_url>`
6. Start Command: `./scripts/aws-entrypoint.sh node scripts/aws-worker.mjs`
7. Click **Create & Deploy**.

---

## 🖥️ Option 4: Deploy on AWS Lightsail or EC2 (Most Economical)

On an Ubuntu Lightsail instance ($3.50 - $5/mo):

```bash
# 1. Install Node.js & Playwright system dependencies
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs dumb-init git

# 2. Clone repository & install dependencies
git clone <your-repo-url> /opt/jobpilot
cd /opt/jobpilot
npm install
npx playwright install-deps chromium
npx playwright install chromium

# 3. Configure environment
cp .env.example .env
nano .env

# 4. Start background runner with PM2
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

---

## ⚙️ Key Environment Variables Reference

| Variable | Description | Default |
| :--- | :--- | :--- |
| `PROFILES` | Comma-separated profiles to run | `tolu,sister` |
| `AI_PROVIDER` | AI provider for scoring (`deepseek`, `gemini`, `openrouter`) | `deepseek` |
| `AI_MODE` | AI evaluation mode (`REAL` or `MOCK`) | `REAL` |
| `PROFILE_BUNDLE_URL` | S3 or HTTPS link to zipped profiles | (optional) |
| `WORKER_RESTART_DELAY_MS` | Milliseconds between scrape passes | `900000` (15m) |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token for review & notifications | (optional) |
| `TELEGRAM_CHAT_ID` | Telegram Chat ID for notifications | (optional) |
| `HEADLESS` | Run Playwright Chromium in headless mode | `true` |
| `AUTO_APPLY` | Enable automatic job submissions | `false` |

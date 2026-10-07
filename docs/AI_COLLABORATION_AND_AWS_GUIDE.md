# JobPilot: Multi-AI Collaboration, AWS Operations & Anti-Vibe-Coding Engineering Guide

> **For any AI Model (Claude Code, ChatGPT/Codex, Gemini, Cursor, Devin, etc.)**:  
> Read this document first before writing or modifying any code in this repository. It defines how to collaborate with other AI models, how to deploy and manage this system on AWS EC2, and how to maintain strict engineering discipline so we never degrade into "vibe coding."

---

## 1. Multi-AI Model Collaboration Protocol

When multiple AI models work on JobPilot across different sessions or tools, they must follow this shared protocol to prevent conflicts, regressions, or corrupted state.

### A. The Single Source of Truth
- **Context & Memory**: [`AGENTS.md`](../AGENTS.md) is the authoritative memory file. Every AI model must read it on startup and update it at the conclusion of significant milestones.
- **Product Identity**: The product name is **JobPilot** (never revert to "JobPilot AI" unless requested).
- **Candidate Profiles**: Strict isolation between:
  - **Tolu** (`profiles/tolu/`): **Full Stack Web Developer** (PHP, Laravel, WordPress, React, JavaScript, HTML/CSS, REST APIs, MySQL, Technical SEO). **NEVER** match customer support, sales, pre-sales, help desk, or business development roles.
  - **Sister** (`profiles/sister/`): **Customer Support & Virtual Assistant** (Zendesk, HubSpot, CRM, email/chat support, data entry, calendar management). **NEVER** match developer or technical engineering roles.

### B. Session Hand-Off Checklist for AI Models
Before finishing any turn or session, the active AI model must:
1. **Run the Test Suite**: Run `npm test`. All 270+ unit and integration tests must pass with 0 failures.
2. **Verify Regressions**: If matching logic or scrapers were modified, run a verification pass to confirm zero role leakage.
3. **Document in Session Log**: Clearly list files modified, new scrapers/adapters added, test status, and remaining work.

---

## 2. AWS EC2 Deployment & Operations Guide

JobPilot can run locally on Windows, on Railway (`jobpilot-scraper`), or as an autonomous headless runner on the user's dedicated AWS EC2 infrastructure.

### A. Server Specifications & SSH Configuration

| Property | Value |
|---|---|
| **Host IP** | `13.60.173.41` |
| **Region** | `eu-north-1` (Stockholm) |
| **SSH User** | `ubuntu` |
| **SSH Key (Primary)** | `C:\Users\USA\.ssh\aws-ec2.pem` |
| **SSH Key (Alternate)** | `C:\laragon\www\kick\my-key.pem` |
| **Operating System** | Ubuntu Linux 24.04 LTS (x86_64) |
| **Runtime Stack** | Node.js v22+, npm, PM2, Python 3, Git, Playwright/Chromium |
| **App Base Directory** | `/home/ubuntu/jobpilot/` |

### B. Remote Operations via SSH (PowerShell on Windows)

```powershell
# 1. Test SSH connectivity
ssh -i "C:\Users\USA\.ssh\aws-ec2.pem" -o "ConnectTimeout=10" ubuntu@13.60.173.41 "uptime"

# 2. Check PM2 status
ssh -i "C:\Users\USA\.ssh\aws-ec2.pem" ubuntu@13.60.173.41 "pm2 status"

# 3. View live JobPilot logs on EC2
ssh -i "C:\Users\USA\.ssh\aws-ec2.pem" ubuntu@13.60.173.41 "pm2 logs jobpilot --lines 50 --nostream"

# 4. Restart JobPilot on EC2
ssh -i "C:\Users\USA\.ssh\aws-ec2.pem" ubuntu@13.60.173.41 "pm2 restart jobpilot"
```

### C. Standard Deployment to AWS EC2

When an AI model is asked to deploy JobPilot to AWS:

```powershell
# Step 1: Package project locally (exclude git, node_modules, temp files, artifacts)
cd "C:\laragon\www\job scrapper"
tar -czf jobpilot.tar.gz --exclude="node_modules" --exclude=".git" --exclude="artifacts" --exclude="logs" --exclude="debug" src profiles data package.json package-lock.json

# Step 2: Upload archive to EC2
scp -i "C:\Users\USA\.ssh\aws-ec2.pem" jobpilot.tar.gz ubuntu@13.60.173.41:/home/ubuntu/
Remove-Item jobpilot.tar.gz

# Step 3: Extract, install dependencies, and launch via PM2
ssh -i "C:\Users\USA\.ssh\aws-ec2.pem" ubuntu@13.60.173.41 "
  mkdir -p /home/ubuntu/jobpilot
  cd /home/ubuntu/jobpilot
  tar -xzf /home/ubuntu/jobpilot.tar.gz
  rm /home/ubuntu/jobpilot.tar.gz
  npm install --omit=dev
  npx playwright install --with-deps chromium
  pm2 start src/index.js --name 'jobpilot' || pm2 restart 'jobpilot'
  pm2 save
"
```

---

## 3. How to Ensure You Are NOT Just "Vibe Coding"

### What is "Vibe Coding"?
**Vibe coding** is prompting an AI to generate code, skimming it superficially, saying "looks reasonable!", and merging or deploying without verifying execution, edge cases, contracts, or regression effects. 
In job application automation, vibe coding leads to catastrophic failures:
- The bot claims it applied, but crashed on a CAPTCHA or missing input.
- Web developer resumes get submitted to entry-level customer service roles.
- Form fields get hallucinated or filled with generic AI garbage.
- Unit tests fail silently and technical debt spirals until the codebase is unmaintainable.

### The 6 Anti-Vibe-Coding Engineering Gates

To ensure real engineering excellence, **every AI model working on this codebase must adhere to these 6 gates**:

#### Gate 1: Contract-First Inspection Before Coding
- **Never guess API or DOM structures**: Before writing a scraper or adapter, probe the real endpoint with an actual HTTP request or headless browser pass (as done for Ashby, Greenhouse, Lever, and BambooHR).
- Inspect the exact JSON fields, HTTP response codes, headers, and DOM selectors.

#### Gate 2: The Test Suite Gate (`npm test`)
- Every new feature, scraper, adapter, or filter **must** have corresponding tests in the `test/` directory.
- Before committing or concluding a task, run `npm test`.
- A passing build of 270+ tests is a non-negotiable requirement.

#### Gate 3: Photographic & Verifiable Proof of Submission
- **Never trust a text response saying "applied"**: An application is only considered complete when:
  1. The ATS confirmation text/URL is detected.
  2. A timestamped screenshot of the confirmation screen is saved to `artifacts/`.
  3. The status is recorded in `processedJobs.json`.

#### Gate 4: Zero-Tolerance Regression & Leak Checks
- When modifying matching logic, run a live benchmark against scraped jobs.
- Explicitly count and assert that leaked non-aligned roles (e.g. sales, customer care for Tolu; engineering for Sister) equals **exactly 0**.

#### Gate 5: Security & Privacy Boundaries
- **Strictly adhere to `AGENTS.md`**:
  - Never commit `.env` or API keys.
  - Never upload candidate resumes, audio files, or private PDFs to public repos.
  - Keep dashboard and runner boundaries distinct (dashboard handles review metadata; runner handles browser automation).

#### Gate 6: Small, Reversible, Audited Commits
- Make atomic, documented changes.
- Explain non-obvious rationale in file edits.
- Maintain documentation integrity (preserve existing docstrings and comments).

---

## Summary Matrix

| Objective | Vibe Coding Anti-Pattern | JobPilot Engineering Standard |
|---|---|---|
| **Form Filling** | Regex guessing on field names | DOM inspection & controlled React input triggers |
| **Job Scraping** | Scraping messy third-party HTML | Direct ATS API querying (Ashby, Greenhouse, Lever) |
| **Verification** | "The script ran with code 0" | Screenshot proof saved in `artifacts/` |
| **Testing** | Manual trial and error | 274+ automated tests in `npm test` |
| **Deployment** | Uploading without checking tests | Test check -> Railway / AWS PM2 deployment -> Log inspection |
| **AI Collaboration** | Context lost between AI chats | Shared memory in `AGENTS.md` and this guide |

# Running JobPilot Silently in Background

JobPilot is configured to run completely in the background without opening terminal windows.

## ✅ Current Configuration

1. **PM2 Configuration** (`ecosystem.config.cjs`):
   - `windowsHide: true` - Hides all PM2 windows
   - `detached: false` - Prevents orphan processes
   - `HEADLESS: true` - Browsers run headless (no UI)
   - `out_file: 'NULL'` - Suppresses console output

2. **Playwright Browsers**:
   - Set to `HEADLESS=true` in `.env`
   - All scrapers run without visible browser windows

## 🚀 How to Start Silently

### Method 1: Using CLI (Recommended)
```bash
jobpilot start
```
This already runs silently via PM2 with `windowsHide: true`.

### Method 2: Using VBS Script (Extra Silent)
Double-click: `start-jobpilot-silent.vbs`

This launches JobPilot with zero console windows.

### Method 3: Windows Task Scheduler (Auto-start on boot)
1. Open Task Scheduler
2. Create Basic Task
3. Trigger: At startup
4. Action: Start a program
5. Program: `wscript.exe`
6. Arguments: `"C:\laragon\www\Job scrapper\start-jobpilot-silent.vbs"`
7. Check "Run whether user is logged on or not"
8. Check "Hidden"

## 🔍 Monitoring

Even though it runs silently, you can monitor it:

```bash
# Check status
jobpilot status

# View logs
jobpilot logs

# Open web dashboard
jobpilot dashboard
```

## 🛑 Stopping

```bash
jobpilot stop
```

## ⚠️ If You Still See Windows

If terminal windows are still appearing:

1. **Check PM2 is updated**:
   ```bash
   pm2 update
   ```

2. **Verify headless mode**:
   Check `.env` has `HEADLESS=true`

3. **Restart JobPilot**:
   ```bash
   jobpilot restart
   ```

4. **Use the VBS script** instead of CLI for maximum silence.

## 📊 Dashboard Access

The web dashboard runs at http://localhost:3000 and is always accessible even when running silently.

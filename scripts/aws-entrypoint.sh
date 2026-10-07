#!/usr/bin/env bash
set -euo pipefail

echo "[bootstrap] JobPilot AWS Entrypoint v1.0.0"

# AWS ECS / App Runner / EC2 Volume Setup
# JobPilot stores persistent data (profiles, logs, review queues, SQLite DB) in /app/data
mkdir -p \
  /app/data/profiles \
  /app/data/logs \
  /app/data/events \
  /app/data/review \
  /app/data/debug \
  /app/data/browser-profiles \
  /app/data/test-results

link_volume_dir() {
  local name="$1"
  local source="/app/${name}"
  local target="/app/data/${name}"

  mkdir -p "$target"

  if [ -d "$source" ] && [ ! -L "$source" ]; then
    # Copy files that do not exist yet on target volume (-n / no-clobber)
    cp -rn "$source/." "$target/" 2>/dev/null || cp -a "$source/." "$target/" 2>/dev/null || true
  fi

  if [ -L "$source" ]; then
    rm "$source"
  elif [ -d "$source" ]; then
    rm -rf "$source"
  elif [ -e "$source" ]; then
    rm -f "$source"
  fi

  ln -s "$target" "$source"
}

link_volume_dir profiles
link_volume_dir logs
link_volume_dir events
link_volume_dir review
link_volume_dir debug
link_volume_dir browser-profiles
link_volume_dir test-results

# Clean stale lock files and bloated artifacts from previous runs
find /app/data -name '*.lock' -type d -prune -exec rm -rf {} + 2>/dev/null || true
find /app/data -name '*.backup-*' -type f -delete 2>/dev/null || true
find /app/data/debug -type f -delete 2>/dev/null || true
find /app/data/test-results -type f -delete 2>/dev/null || true
find /app/data/browser-profiles -type f -name '*.log' -delete 2>/dev/null || true

# Download profiles bundle if configured via S3 / HTTPS URL
if [ -n "${PROFILE_BUNDLE_URL:-}" ]; then
  echo "[bootstrap] PROFILE_BUNDLE_URL is set. Downloading profiles bundle..."
  mkdir -p /app/data
  node ./scripts/download-profile-bundle.mjs "${PROFILE_BUNDLE_URL}" /tmp/jobpilot-profile-bundle

  format="${PROFILE_BUNDLE_FORMAT:-tar.gz}"
  echo "[bootstrap] Extracting profile bundle as ${format}..."
  if [ "$format" = "zip" ]; then
    if ! command -v unzip >/dev/null 2>&1; then
      echo "[bootstrap] unzip is not installed. Use a tar.gz bundle or set PROFILE_BUNDLE_FORMAT=tar.gz."
      exit 1
    fi
    unzip -t /tmp/jobpilot-profile-bundle >/dev/null
    unzip -o /tmp/jobpilot-profile-bundle -d /app/data/
  else
    gzip -t /tmp/jobpilot-profile-bundle
    tar -xzf /tmp/jobpilot-profile-bundle -C /app/data/
  fi

  rm -f /tmp/jobpilot-profile-bundle
  echo "[bootstrap] Done. Profiles found:"
  ls /app/data/profiles/ 2>/dev/null || echo "  (none - check bundle structure)"
else
  echo "[bootstrap] PROFILE_BUNDLE_URL not set; using local / mounted volume profiles."
fi

echo "[bootstrap] Available profile files:"
find /app/data/profiles -maxdepth 2 -type f -print 2>/dev/null | sed 's#^#  #' || true

if [ "${WIPE_DB:-}" = "true" ]; then
  echo "[bootstrap] WIPE_DB is true. Resetting processed jobs..."
  node clearIgnored.js
fi

if [ -f "./scripts/build-resume-library.mjs" ]; then
  echo "[bootstrap] Ensuring fixed resume library is compiled..."
  node ./scripts/build-resume-library.mjs 2>&1 || true
fi

for item_profile in ${PROFILES:-}; do
  item_profile="${item_profile//,/ }"
  for name in $item_profile; do
    if [ "$name" != "example" ] && [ ! -f "/app/data/profiles/${name}/resume.pdf" ]; then
      echo "[bootstrap] Warning: /app/data/profiles/${name}/resume.pdf is missing."
    fi
  done
done

export JOBPILOT_PROFILE_BOOTSTRAPPED=1
export JOBPILOT_CLOUD_RUNTIME=aws

exec "$@"

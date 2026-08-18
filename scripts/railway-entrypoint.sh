#!/usr/bin/env bash
set -euo pipefail

echo "[bootstrap] JobPilot Railway entrypoint v2026-06-03-2"

# Railway mounts volumes at runtime. JobPilot writes state to repo-relative
# paths, so link those paths into the /app/data volume before the runner starts.
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

  if [ "$name" = "profiles" ] && [ -d "$source/example" ] && [ ! -d "$target/example" ]; then
    cp -a "$source/example" "$target/example"
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

# Stale lock directories can survive a crash and then fail hard when the
# volume is tight. Remove only generated lock dirs, never profile documents.
find /app/data -name '*.lock' -type d -prune -exec rm -rf {} + 2>/dev/null || true

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
  echo "[bootstrap] PROFILE_BUNDLE_URL is not set; using existing Railway volume profiles."
fi

echo "[bootstrap] Profile files:"
find /app/data/profiles -maxdepth 2 -type f -print 2>/dev/null | sed 's#^#  #' || true

if [ "${WIPE_DB:-}" = "true" ]; then
  echo "[bootstrap] WIPE_DB is true. Wiping processed jobs..."
  node clearIgnored.js
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

# Optional, restart-safe maintenance hook for Railway operations. The marker
# in /app/data/maintenance makes this safe across deploy restarts; after the
# requested task completes, normal scheduler startup continues unchanged.
if [ -n "${JOBPILOT_BRUNTWORK_RECHECK_ID:-}" ]; then
  echo "[bootstrap] Running requested BruntWork recheck: ${JOBPILOT_BRUNTWORK_RECHECK_ID}"
  node ./scripts/ops/run-bruntwork-recheck-once.mjs
fi

if [ -n "${JOBPILOT_BRUNTWORK_TARGETED_URL:-}" ]; then
  echo "[bootstrap] Running requested targeted BruntWork check"
  targeted_args=(
    --profile="${JOBPILOT_BRUNTWORK_TARGETED_PROFILE:-tolu}"
    --url="${JOBPILOT_BRUNTWORK_TARGETED_URL}"
  )
  if [ "${JOBPILOT_BRUNTWORK_TARGETED_FORCE_REVIEWED:-false}" = "true" ]; then
    targeted_args+=(--force-reviewed)
  fi
  node ./scripts/apply-bruntwork-targeted.mjs "${targeted_args[@]}"
fi

if [ -n "${JOBPILOT_REQUEUE_JOBBERMAN_ID:-}" ]; then
  echo "[bootstrap] Requeuing accepted Jobberman reviews"
  node ./scripts/ops/requeue-accepted-jobberman-once.mjs
fi

if [ -n "${JOBPILOT_BRUNTWORK_LIVE_RERUN_ID:-}" ]; then
  echo "[bootstrap] Running requested live BruntWork rerun: ${JOBPILOT_BRUNTWORK_LIVE_RERUN_ID}"
  node ./scripts/ops/run-bruntwork-live-rerun-once.mjs
fi

if [ -n "${JOBPILOT_RESTAGE_INCOMPLETE_BRUNTWORK_ID:-}" ]; then
  echo "[bootstrap] Restaging requested incomplete BruntWork drafts: ${JOBPILOT_RESTAGE_INCOMPLETE_BRUNTWORK_ID}"
  node ./scripts/ops/restage-incomplete-bruntwork-tolu-once.mjs
fi

if [ -n "${JOBPILOT_RESET_BRUNTWORK_ID:-}" ]; then
  echo "[bootstrap] Resetting failed/reviewed BruntWork jobs: ${JOBPILOT_RESET_BRUNTWORK_ID}"
  node ./scripts/ops/reset-bruntwork-jobs-once.mjs
fi

if [ -n "${JOBPILOT_RESET_SITE:-}" ]; then
  echo "[bootstrap] Resetting non-applied jobs for site: ${JOBPILOT_RESET_SITE}"
  node ./scripts/ops/reset-site-jobs-once.mjs
fi

if [ -n "${JOBPILOT_SKIP_TITLES:-}" ]; then
  echo "[bootstrap] Skipping requested profile titles"
  node ./scripts/ops/skip-profile-titles-once.mjs
fi

if [ "${JOBPILOT_WRITE_CLEAN_PREFS:-}" = "true" ]; then
  echo "[bootstrap] Writing clean bruntwork-only preferences to volume..."
  node ./scripts/ops/write_clean_prefs.cjs
fi

exec "$@"

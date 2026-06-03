#!/usr/bin/env bash
set -euo pipefail

if [ -n "${PROFILE_BUNDLE_URL:-}" ]; then
  echo "[bootstrap] Downloading profiles bundle..."
  mkdir -p /app/data
  node ./scripts/download-profile-bundle.mjs "${PROFILE_BUNDLE_URL}" /tmp/jobpilot-profile-bundle

  format="${PROFILE_BUNDLE_FORMAT:-tar.gz}"
  if [ "$format" = "zip" ]; then
    if ! command -v unzip >/dev/null 2>&1; then
      echo "[bootstrap] unzip is not installed. Use a tar.gz bundle or set PROFILE_BUNDLE_FORMAT=tar.gz."
      exit 1
    fi
    unzip -o /tmp/jobpilot-profile-bundle -d /app/data/
  else
    tar -xzf /tmp/jobpilot-profile-bundle -C /app/data/
  fi

  rm -f /tmp/jobpilot-profile-bundle
  echo "[bootstrap] Done. Profiles found:"
  ls /app/data/profiles/ 2>/dev/null || echo "  (none - check bundle structure)"
else
  echo "[bootstrap] PROFILE_BUNDLE_URL is not set; using existing Railway volume profiles."
fi

# Railway mounts volumes at runtime. JobPilot writes state to repo-relative
# paths, so link those paths into the /app/data volume before the runner starts.
mkdir -p \
  /app/data/profiles \
  /app/data/logs \
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
link_volume_dir review
link_volume_dir debug
link_volume_dir browser-profiles
link_volume_dir test-results

exec "$@"

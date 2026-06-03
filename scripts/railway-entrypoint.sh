#!/usr/bin/env bash
# ── Profile bootstrap ────────────────────────────────────────────────────────
if [ -n "${PROFILE_BUNDLE_URL}" ]; then
  echo "[bootstrap] Downloading profiles bundle..."
  mkdir -p /app/data
  curl -L "${PROFILE_BUNDLE_URL}" -o /tmp/profiles.zip
  unzip -o /tmp/profiles.zip -d /app/data/
  rm -f /tmp/profiles.zip
  echo "[bootstrap] Done. Profiles found:"
  ls /app/data/profiles/ 2>/dev/null || echo "  (none — check zip structure)"
fi
# ────────────────────────────────────────────────────────────────────────────

set -euo pipefail

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

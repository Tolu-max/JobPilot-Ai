#!/usr/bin/env bash
set -euo pipefail

echo "[bootstrap] JobPilot Railway entrypoint v2026-06-03-2"

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

for profile in ${PROFILES:-}; do
  profile="${profile//,/ }"
  for name in $profile; do
    if [ "$name" != "example" ] && [ ! -f "/app/data/profiles/${name}/resume.pdf" ]; then
      echo "[bootstrap] Warning: /app/data/profiles/${name}/resume.pdf is missing."
    fi
  done
done

exec "$@"

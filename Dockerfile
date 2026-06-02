# JobPilot — Docker image
# Built on Microsoft's Playwright image so Chromium + system deps are preinstalled.
# Multi-arch (amd64/arm64) friendly. ~1.4 GB final size.

FROM mcr.microsoft.com/playwright:v1.49.1-jammy

ENV NODE_ENV=production \
    TZ=UTC \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false \
    # Skip Playwright postinstall — browsers come from the base image
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    JOBPILOT_REQUIRE_AUTH=false

WORKDIR /app

# Install deps first to maximise Docker layer caching
COPY package.json package-lock.json* ./
# `npm ci` is strict about lockfiles; fall back if missing
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts; \
    else npm install --omit=dev --ignore-scripts; fi \
    && npm rebuild better-sqlite3

COPY . .

RUN chmod +x ./scripts/railway-entrypoint.sh

ENTRYPOINT ["./scripts/railway-entrypoint.sh"]

# Default = the long-running scheduler. Override with:
#   docker run ... jobpilot-cli node cli.js run --profile=sister
CMD ["node", "cli.js", "scheduler"]

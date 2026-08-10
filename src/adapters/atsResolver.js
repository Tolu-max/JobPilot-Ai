import { emitEvent, EventTypes } from '../eventBus.js';

const PLATFORM_RULES = [
  {
    adapter: 'greenhouse',
    label: 'Greenhouse',
    kind: 'ats',
    audited: true,
    patterns: [/(?:boards|job-boards)\.greenhouse\.io/i]
  },
  {
    adapter: 'applytojob',
    label: 'ApplyToJob',
    kind: 'ats',
    audited: true,
    patterns: [/applytojob\.com\/apply/i]
  },
  {
    adapter: 'bruntwork',
    label: 'BruntWork',
    kind: 'site',
    audited: true,
    patterns: [/bruntwork(careers)?\.co/i, /apply\.bruntwork/i]
  },
  {
    adapter: 'influx',
    label: 'Influx',
    kind: 'site',
    audited: true,
    patterns: [/influx\.com\/forms\//i, /influx\.typeform\.com\//i]
  },
  {
    adapter: 'jobberman',
    label: 'Jobberman',
    kind: 'site',
    audited: true,
    patterns: [/jobberman\.com/i]
  },
  {
    adapter: 'remotejobsorg',
    label: 'RemoteJobs.org',
    kind: 'gateway',
    audited: true,
    patterns: [/remotejobs\.org\/remote-jobs\//i]
  },
  {
    adapter: 'remoteok',
    label: 'RemoteOK',
    kind: 'gateway',
    audited: true,
    patterns: [/remoteok\.com\/remote-jobs\//i]
  },
  {
    adapter: 'lever',
    label: 'Lever',
    kind: 'ats',
    audited: true,
    patterns: [/jobs\.lever\.co/i]
  },
  {
    adapter: 'workable',
    label: 'Workable',
    kind: 'ats',
    audited: true,
    patterns: [/apply\.workable\.com/i, /jobs\.workable\.com/i]
  },
  {
    adapter: 'ashby',
    label: 'Ashby',
    kind: 'ats',
    audited: true,
    patterns: [/jobs\.ashbyhq\.com/i, /app\.ashbyhq\.com/i]
  },
  {
    adapter: 'smartrecruiters',
    label: 'SmartRecruiters',
    kind: 'ats',
    audited: false,
    patterns: [/jobs\.smartrecruiters\.com/i, /smartrecruiters\.com\/.+\/jobs\//i]
  },
  {
    adapter: 'workday',
    label: 'Workday',
    kind: 'ats',
    audited: false,
    patterns: [/myworkdayjobs\.com/i, /workdayjobs\.com/i]
  },
  {
    adapter: 'bamboohr',
    label: 'BambooHR',
    kind: 'ats',
    audited: true,
    patterns: [/\.bamboohr\.com\/careers/i]
  }
];

export function detectApplyPlatform(url) {
  const value = String(url || '').trim();
  if (!value) return null;
  if (/^mailto:/i.test(value)) {
    return { adapter: 'email', label: 'Email', kind: 'manual', audited: false };
  }
  if (/^tel:/i.test(value)) {
    return { adapter: 'phone', label: 'Phone', kind: 'manual', audited: false };
  }

  for (const rule of PLATFORM_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(value))) {
      return {
        adapter: rule.adapter,
        label: rule.label,
        kind: rule.kind,
        audited: rule.audited
      };
    }
  }

  return null;
}

export function detectDownstreamAdapter(url) {
  return detectApplyPlatform(url)?.adapter || '';
}

export function classifyApplyUrl(url, { source = '' } = {}) {
  const value = normalizeApplyUrl(url);
  if (!value) return basicResult(value, false, '', 'empty-url');

  const platform = detectApplyPlatform(value);
  if (!platform) return basicResult(value, false, '', 'unknown-ats');

  if (platform.adapter === 'email') return basicResult(value, false, 'email', 'email-only', platform);
  if (platform.adapter === 'phone') return basicResult(value, false, 'phone', 'phone-only', platform);
  if (source && platform.adapter === source) {
    return basicResult(value, false, platform.adapter, `same-${source}-page`, platform);
  }

  const reason = platform.audited ? 'supported-audited-adapter' : 'adapter-not-audited';
  return basicResult(value, platform.audited, platform.adapter, reason, platform);
}

export function shouldAllowGatewayHandoff(classification, config = {}) {
  if (!classification?.supported) return false;
  if (config.testMode || config.noRealSubmission) return true;
  return Boolean(config.allowGatewayAutoSubmit || config.allowGatewayLiveHandoff);
}

export function gatewayHandoffBlockedReason(sourceLabel, classification, url) {
  const adapter = classification?.adapter || 'unknown destination';
  const destination = url || classification?.url || '';
  return `${sourceLabel} resolved to ${adapter}, but live gateway handoff is disabled. Set ALLOW_GATEWAY_AUTO_SUBMIT=true after testing this source-to-adapter flow: ${destination}`;
}

function basicResult(url, supported, adapter, reason, platform = {}) {
  return {
    supported,
    adapter,
    reason,
    url,
    label: platform.label || adapter || '',
    kind: platform.kind || '',
    audited: Boolean(platform.audited)
  };
}

function normalizeApplyUrl(value) {
  const url = String(value || '').trim();
  if (!url) return '';
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}

// Telemetry: record what a gateway job (remoteok/remotejobsorg) resolved to,
// regardless of whether we ended up handing off, bailing as unaudited/unknown,
// or finding handoff disabled. This accumulates the ATS distribution in
// data/events/*.jsonl so we can prioritise which downstream ATS adapter to build
// next. Must never throw into the apply flow.
export async function recordGatewayDestination(ctx = {}, page = null, classification = {}, resolvedUrl = '', source = '') {
  const destination = resolvedUrl || classification.url || '';
  if (!destination) return; // nothing resolved yet — skip empty telemetry rows
  const jobUrl =
    ctx.job?.applicationUrl ||
    ctx.job?.raw?.url ||
    (typeof page?.url === 'function' ? page.url() : '') ||
    '';
  const payload = {
    gatewaySource: source || ctx.job?.source_site || ctx.job?.source || '',
    jobUrl,
    resolvedUrl: destination,
    downstreamAdapter: classification.adapter || '',
    audited: Boolean(classification.audited),
    supported: Boolean(classification.supported),
    classificationReason: classification.reason || ''
  };
  await emitEvent(EventTypes.GATEWAY_DESTINATION_RESOLVED, payload, ctx.config || {}).catch(() => {});
}

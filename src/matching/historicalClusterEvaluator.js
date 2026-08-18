/**
 * Historical Role Cluster & Empirical Success Evaluator
 *
 * Deterministic, zero-token layer calibrated on 2026 ground-truth application outcomes:
 * - Tolu: WordPress & SEO (8.5% recruiter, 2.8% client); Laravel/PHP Full-Stack (7.7% recruiter);
 *         Shopify & generic Frontend (0% recruiter across 85 apps - penalized).
 * - Sister: Real Estate VA / Appointment Setting / Outreach (1.8% recruiter);
 *           Generic Data Entry & Customer Support (0% recruiter across hundreds of apps - penalized).
 */

export const ClusterTier = Object.freeze({
  PROVEN_WINNER: 'PROVEN_WINNER',      // Highest historical conversion (+15 to +25 score)
  SELECTIVE_FIT: 'SELECTIVE_FIT',      // Moderate historical conversion (+5 to +10 score)
  FAILED_DEAD_CLUSTER: 'FAILED_DEAD',  // 0% historical conversion despite volume (-25 to -35 penalty)
  HARD_EXCLUSION: 'HARD_EXCLUSION'     // Incompatible profession / hard disqualifier (Score = 0)
});

/**
 * Evaluate job against candidate's historical success clusters and hard requirements.
 *
 * @param {object} job - Scraped job posting { title, description, requirements, company }
 * @param {string} candidateId - 'tolu' or 'sister'
 * @returns {object} Empirical evaluation result { tier, clusterName, scoreAdjustment, hardMiss, reasons }
 */
export function evaluateHistoricalCluster(job = {}, candidateId = 'tolu') {
  const profile = String(candidateId || 'tolu').toLowerCase().trim();
  const title = String(job.title || '').toLowerCase();
  const fullText = `${title} ${String(job.description || '')} ${String(job.requirements || '')}`.toLowerCase();

  if (profile === 'tolu') {
    return evaluateToluCluster(title, fullText);
  }

  if (profile === 'sister') {
    return evaluateSisterCluster(title, fullText);
  }

  return {
    tier: ClusterTier.SELECTIVE_FIT,
    clusterName: 'General Technical Fit',
    scoreAdjustment: 0,
    hardMiss: false,
    reasons: []
  };
}

function evaluateToluCluster(title, fullText) {
  // 1. Hard Exclusions for Tolu (Non-technical / Admin / VA / Customer Care)
  if (/\b(?:virtual assistant|executive assistant|office assistant|admin assistant|administrative assistant|receptionist|bookkeeper|data entry clerk|non-technical customer support|telemarketing|cold caller)\b/i.test(title)) {
    return {
      tier: ClusterTier.HARD_EXCLUSION,
      clusterName: 'Administrative & Non-Technical Support (Excluded)',
      scoreAdjustment: -100,
      hardMiss: true,
      reasons: ['Tolu is strictly a Web Developer and Technical SEO Specialist; administrative/non-technical roles are excluded.']
    };
  }

  // 2. Hard Requirements Misses for Tolu
  // Shopify Liquid custom theme development / App ecosystem
  const isShopifyLiquidSpecialist = /\b(?:shopify liquid|liquid template|shopify theme developer|shopify app developer|build custom shopify themes)\b/i.test(fullText);
  // Pure React/Vue/Angular/TypeScript frontend framework engineer
  const isPureSpaEngineer = /\b(?:react\.js|reactjs|vue\.js|vuejs|angular|typescript|redux|zustand|next\.js)\b/i.test(title) ||
    (/\b(?:senior|lead)\s+(?:react|frontend)\b/i.test(title) && /\b(?:react|vue|angular)\b/i.test(fullText));
  // Video Editing / Multimedia / CapCut
  const isVideoEditor = /\b(?:video editor|capcut|premiere pro|after effects|video editing|video creation)\b/i.test(title);

  if (isShopifyLiquidSpecialist) {
    return {
      tier: ClusterTier.FAILED_DEAD_CLUSTER,
      clusterName: 'Shopify Liquid Theme Developer (Failed Cluster)',
      scoreAdjustment: -35,
      hardMiss: true,
      reasons: ['Role demands specialized Shopify Liquid theme/app development; historically 0% conversion across 65 applications.']
    };
  }

  if (isPureSpaEngineer) {
    return {
      tier: ClusterTier.FAILED_DEAD_CLUSTER,
      clusterName: 'SPA Frontend Framework Developer (Failed Cluster)',
      scoreAdjustment: -30,
      hardMiss: true,
      reasons: ['Role strictly requires React/Vue/TypeScript SPA engineering; candidate core is PHP/Laravel/WordPress/Blade/jQuery.']
    };
  }

  if (isVideoEditor) {
    return {
      tier: ClusterTier.FAILED_DEAD_CLUSTER,
      clusterName: 'Video Editing & Multimedia (Failed Cluster)',
      scoreAdjustment: -40,
      hardMiss: true,
      reasons: ['Role is focused on video editing (CapCut/Premiere); outside candidate technical development domain.']
    };
  }

  // 3. Proven Winner Cluster for Tolu: WordPress & Technical SEO
  const isWordPressSeo = /\b(?:wordpress|elementor|oxygen|wp developer|wp specialist|seo specialist|technical seo|on-page seo|search engine optimization|organic search|search strategist|link building)\b/i.test(title) ||
    (/\b(?:seo|wordpress)\b/i.test(title) && /\b(?:optimization|content|web|rank|audit)\b/i.test(fullText));

  if (isWordPressSeo) {
    return {
      tier: ClusterTier.PROVEN_WINNER,
      clusterName: 'WordPress & Technical SEO (Proven Winner)',
      scoreAdjustment: 20,
      hardMiss: false,
      reasons: ['Highest converting historical cluster (8.5% recruiter interview rate, 2.8% client interview rate in 2026).']
    };
  }

  // 4. Selective Winner Cluster for Tolu: PHP, Laravel, Full-Stack Development
  const isPhpLaravelFullstack = /\b(?:laravel|php|full.?stack|backend developer|web developer|mysql|rest api|api integration|web designer & developer|web operations)\b/i.test(title);

  if (isPhpLaravelFullstack) {
    return {
      tier: ClusterTier.SELECTIVE_FIT,
      clusterName: 'PHP & Laravel Full-Stack (Selective Winner)',
      scoreAdjustment: 10,
      hardMiss: false,
      reasons: ['Strong foundational match (7.7% recruiter screening rate in 2026).']
    };
  }

  // 5. Default General Technical Evaluation
  return {
    tier: ClusterTier.SELECTIVE_FIT,
    clusterName: 'General Web & Technical Support',
    scoreAdjustment: 0,
    hardMiss: false,
    reasons: ['General web/technical role evaluated on core skills.']
  };
}

function evaluateSisterCluster(title, fullText) {
  // 1. Hard Exclusions for Sister (Software Engineering / DevOps / Finance)
  if (/\b(?:software engineer|software developer|web developer|backend developer|devops|full.?stack|data engineer|financial trader)\b/i.test(title)) {
    return {
      tier: ClusterTier.HARD_EXCLUSION,
      clusterName: 'Software Engineering & Technical Dev (Excluded)',
      scoreAdjustment: -100,
      hardMiss: true,
      reasons: ['Sister is targeting Customer Support, Virtual Assistance, and Operations; software engineering roles are excluded.']
    };
  }

  // 2. Hard Requirements Misses for Sister
  // Foreign language requirements
  const requiresBilingual = /\b(?:bilingual spanish|fluent spanish|german speaker|french speaker|portuguese speaker|japanese speaker)\b/i.test(fullText);
  // High-quota aggressive outbound sales SDR
  const isAggressiveSdr = /\b(?:quota-carrying|cold caller|cold calling|telemarketing|sdr\/bdr|aggressive outbound)\b/i.test(title) &&
    !/\b(?:appointment setter|appointment setting|real estate|realty)\b/i.test(title);

  if (requiresBilingual) {
    return {
      tier: ClusterTier.HARD_EXCLUSION,
      clusterName: 'Foreign Language Requirement (Hard Miss)',
      scoreAdjustment: -100,
      hardMiss: true,
      reasons: ['Role strictly requires foreign language fluency (Spanish/French/German); candidate is English-speaking.']
    };
  }

  if (isAggressiveSdr) {
    return {
      tier: ClusterTier.FAILED_DEAD_CLUSTER,
      clusterName: 'Outbound Cold-Calling SDR (Failed Cluster)',
      scoreAdjustment: -35,
      hardMiss: true,
      reasons: ['Role is heavy quota cold calling sales; outside demonstrated support and appointment coordination experience.']
    };
  }

  // 3. Proven Winner Cluster for Sister: Real Estate VA / Appointment Setting / Outreach
  const isRealEstateOrOutreach = /\b(?:realty|real estate|appointment setter|appointment setting|influencer outreach|outreach specialist|lead qualification|lead coordinator)\b/i.test(title) ||
    (/\b(?:virtual assistant|admin assistant)\b/i.test(title) && /\b(?:real estate|property|booking|scheduling|outreach)\b/i.test(fullText));

  if (isRealEstateOrOutreach) {
    return {
      tier: ClusterTier.PROVEN_WINNER,
      clusterName: 'Real Estate VA & Appointment Setting (Proven Winner)',
      scoreAdjustment: 20,
      hardMiss: false,
      reasons: ['Highest converting historical cluster (100% of Sister\'s 2026 recruiter interview invitations).']
    };
  }

  // 4. Selective Fit Cluster for Sister: CRM, Operations Assistant, Executive Support
  const isOperationsOrCrm = /\b(?:crm specialist|hubspot|salesforce|operations assistant|executive assistant|administrative coordinator|onboarding coordinator|client operations)\b/i.test(title);

  if (isOperationsOrCrm) {
    return {
      tier: ClusterTier.SELECTIVE_FIT,
      clusterName: 'CRM & Operations Coordination (Selective Fit)',
      scoreAdjustment: 10,
      hardMiss: false,
      reasons: ['Solid operational and CRM match with transferable workflow coordination skills.']
    };
  }

  // 5. Saturated / Dead Cluster for Sister: Generic Data Entry / Generalist Customer Care
  const isGenericDataEntryOrSupport = /\b(?:data entry|data collection|data clerk|typist|customer service representative|call center agent)\b/i.test(title);

  if (isGenericDataEntryOrSupport) {
    return {
      tier: ClusterTier.FAILED_DEAD_CLUSTER,
      clusterName: 'Generic Data Entry & Call Center (Saturated Cluster)',
      scoreAdjustment: -25,
      hardMiss: false,
      reasons: ['High competition / saturated role family; 0% interview conversion in 2026 across hundreds of applications.']
    };
  }

  return {
    tier: ClusterTier.SELECTIVE_FIT,
    clusterName: 'General Support & Operations',
    scoreAdjustment: 0,
    hardMiss: false,
    reasons: ['General support role evaluated on core administrative skills.']
  };
}

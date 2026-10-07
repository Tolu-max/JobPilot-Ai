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
  // 1. Hard Exclusions for Tolu (Non-technical / Admin / VA / Customer Care / Sales / Sourcing / Medical / Accounting / Debt Collection)
  if (/\b(?:collection specialist|debt collection|debt collector|loan recovery|credit recovery|recovery officer|field verification|field agent|field officer|virtual assistant|executive assistant|office assistant|admin assistant|administrative assistant|receptionist|bookkeeper|data entry clerk|non-technical customer support|telemarketing|medical assistant|nurse|clinical|attorney|paralegal|global sourcing|product sourcing|sourcing coordinator|sourcing specialist|sourcing manager|procurement|supply chain|sales coordinator|sales representative|sales support|sales development|inside sales|appointment setter|telemarketer|call center agent|logistics coordinator|vendor coordinator|inventory clerk|account executive|business development representative|bdr|sdr|recruiter|talent acquisition)\b/i.test(title)) {
    return {
      tier: ClusterTier.HARD_EXCLUSION,
      clusterName: 'Administrative, Sales & Non-Technical Support (Excluded)',
      scoreAdjustment: -100,
      hardMiss: true,
      reasons: ['Tolu is strictly a Web Developer and Technical SEO Specialist; administrative, sales, sourcing, and non-technical roles are excluded.']
    };
  }

  // 2. Conflicting Requirement Checks: Paid Ads, Video Editing, or Heavy Frameworks that disqualify SEO/WordPress
  const isPaidAdsDominant = /\b(?:google ads|meta ads|facebook ads|ppc specialist|paid ads manager|media buyer|media buying|tiktok ads|ad spend)\b/i.test(title) ||
    (/\b(?:google ads|meta ads|paid advertising|ppc)\b/i.test(fullText) && !/\b(?:technical seo|on-page seo|organic search|wordpress)\b/i.test(title));

  const isVideoOrCapCutDominant = /\b(?:capcut|video editor|video editing|video creation|premiere pro|after effects|inshot|reels creator)\b/i.test(title) ||
    (/\b(?:capcut|video editing|premiere)\b/i.test(fullText) && !/\b(?:web developer|php|laravel|seo)\b/i.test(title));

  const isShopifyLiquidSpecialist = /\b(?:shopify liquid|liquid template|shopify theme developer|shopify app developer|build custom shopify themes)\b/i.test(fullText) ||
    /\bshopify\b/i.test(title);

  const isPureSpaEngineer = /\b(?:react\.js|reactjs|vue\.js|vuejs|angular|typescript|redux|zustand|next\.js|python\/django|django developer|golang developer|go developer)\b/i.test(title) ||
    (/\b(?:senior|lead)\s+(?:react|frontend|full.?stack)\b/i.test(title) && /\b(?:react|vue|angular|django)\b/i.test(fullText));

  if (isPaidAdsDominant) {
    return {
      tier: ClusterTier.FAILED_DEAD_CLUSTER,
      clusterName: 'Paid Ads & PPC Marketing (Failed Cluster)',
      scoreAdjustment: -35,
      hardMiss: true,
      reasons: ['Role is primarily paid ads/PPC (Google/Meta Ads); candidate focus is organic technical SEO and web development.']
    };
  }

  if (isVideoOrCapCutDominant) {
    return {
      tier: ClusterTier.FAILED_DEAD_CLUSTER,
      clusterName: 'Video Editing & Multimedia (Failed Cluster)',
      scoreAdjustment: -40,
      hardMiss: true,
      reasons: ['Role is focused on video editing (CapCut/Premiere); outside candidate technical development domain.']
    };
  }

  if (isShopifyLiquidSpecialist) {
    return {
      tier: ClusterTier.FAILED_DEAD_CLUSTER,
      clusterName: 'Shopify / E-Commerce Operations (Failed Cluster)',
      scoreAdjustment: -35,
      hardMiss: true,
      reasons: ['Role demands dedicated Shopify/e-commerce store operations; historically 0% conversion across 65 applications in 2026.']
    };
  }

  if (isPureSpaEngineer) {
    return {
      tier: ClusterTier.FAILED_DEAD_CLUSTER,
      clusterName: 'SPA / Django / Go Framework Engineering (Failed Cluster)',
      scoreAdjustment: -30,
      hardMiss: true,
      reasons: ['Role strictly requires React/Vue/TypeScript/Django/Go engineering; candidate core is PHP/Laravel/WordPress/Blade/jQuery.']
    };
  }

  // 3. Proven Winner Cluster for Tolu: WordPress & Technical SEO
  const isWordPressSeo = /\b(?:wordpress|elementor|oxygen|wp developer|wp specialist|seo specialist|technical seo|on-page seo|search engine optimization|organic search|search strategist|link building|website design & seo|website optimization|content optimization|website management)\b/i.test(title) ||
    (/\b(?:seo|wordpress)\b/i.test(title) && /\b(?:optimization|content|web|rank|audit|speed)\b/i.test(fullText));

  if (isWordPressSeo) {
    return {
      tier: ClusterTier.PROVEN_WINNER,
      clusterName: 'WordPress & Technical SEO (Proven Winner)',
      scoreAdjustment: 20,
      hardMiss: false,
      reasons: ['Highest converting historical cluster (8.5% recruiter interview rate, 2.8% client interview rate in 2026).']
    };
  }

  // 4. Selective Winner Cluster for Tolu: PHP, Laravel, Full-Stack Web Development, Web Operations
  const isPhpLaravelFullstack = /\b(?:laravel|php|full.?stack|backend developer|web developer|mysql|rest api|api integration|web designer & developer|web operations|web development & marketing|creative web & graphics)\b/i.test(title) ||
    (/\b(?:web developer|full-stack)\b/i.test(title) && /\b(?:php|laravel|javascript|mysql|apis?)\b/i.test(fullText));

  if (isPhpLaravelFullstack) {
    return {
      tier: ClusterTier.SELECTIVE_FIT,
      clusterName: 'PHP & Laravel Full-Stack (Selective Winner)',
      scoreAdjustment: 10,
      hardMiss: false,
      reasons: ['Strong foundational match (7.7% recruiter screening rate in 2026).']
    };
  }

  // 5. If title has no technical/web developer evidence, it is an excluded/dead role for Tolu
  const hasTechnicalTitle = /\b(?:web|website|webmaster|developer|engineer|software|seo|search|wordpress|shopify|frontend|front end|backend|full.?stack|php|laravel|javascript|html|css|cms|ui|ux|site admin|programmer|tech support)\b/i.test(title);
  if (!hasTechnicalTitle) {
    return {
      tier: ClusterTier.HARD_EXCLUSION,
      clusterName: 'Non-Technical Role Family (Excluded)',
      scoreAdjustment: -100,
      hardMiss: true,
      reasons: ['Role title is outside Tolu\'s web development and technical SEO domain.']
    };
  }

  // 6. Default General Technical Evaluation (only for roles with technical title)
  return {
    tier: ClusterTier.SELECTIVE_FIT,
    clusterName: 'General Web & Technical Support',
    scoreAdjustment: 0,
    hardMiss: false,
    reasons: ['General web/technical role evaluated on core skills.']
  };
}

function evaluateSisterCluster(title, fullText) {
  // 1. Hard Exclusions for Sister (Technical / Specialized Clinical / Formal Accounting / Legal / Advanced Multimedia / IT / Debt Collection)
  if (/\b(?:software engineer|software developer|web developer|backend developer|devops|full.?stack|data engineer|financial trader|medical billing|clinical coder|registered nurse|cpa\b|chartered accountant|auditor|tax specialist|collection specialist|debt collection|debt collector|loan recovery|credit recovery|recovery officer|field verification|field agent|field officer|legal support|legal assistant|paralegal|leap crm|law clerk|attorney|medical receptionist|patient coordinator|gentu|clinic receptionist|dental receptionist|senior video editor|lead video editor|motion designer|motion graphics|animator|animation|vfx|3d artist|blender|art director|creative director|brand identity designer|lead graphic designer|senior graphic designer|cinematographer|video producer|it specialist|microsoft support specialist|systems administrator|network engineer|sysadmin|real estate listing coordinator)\b/i.test(title) ||
      /\b(?:door-to-door|spot checks?|field verification|loan recovery)\b/i.test(fullText)) {
    return {
      tier: ClusterTier.HARD_EXCLUSION,
      clusterName: 'Specialized Non-VA/Support Domain (Hard Exclusion)',
      scoreAdjustment: -100,
      hardMiss: true,
      reasons: ['Sister is strictly targeting Customer Support, Virtual Assistance, CRM/Admin Operations, and Social Media/Basic Content; specialized domains (legal, medical, advanced video production/VFX, IT systems) are hard-excluded.']
    };
  }

  // 2. Hard Requirements Misses for Sister
  const requiresBilingual = /\b(?:bilingual spanish|fluent spanish|german speaker|french speaker|portuguese speaker|japanese speaker|italian speaker|mandarin)\b/i.test(fullText);
  const isAggressiveQuotaSdr = /\b(?:quota-carrying|cold caller|cold calling|telemarketing|sdr\/bdr|aggressive outbound|100\+? dials)\b/i.test(title) &&
    !/\b(?:appointment setter|appointment setting|real estate|realty|outreach)\b/i.test(title);

  if (requiresBilingual) {
    return {
      tier: ClusterTier.HARD_EXCLUSION,
      clusterName: 'Foreign Language Requirement (Hard Miss)',
      scoreAdjustment: -100,
      hardMiss: true,
      reasons: ['Role strictly requires foreign language fluency (Spanish/French/German); candidate is English-speaking.']
    };
  }

  if (isAggressiveQuotaSdr) {
    return {
      tier: ClusterTier.FAILED_DEAD_CLUSTER,
      clusterName: 'Quota-Carrying Outbound SDR (Failed Cluster)',
      scoreAdjustment: -35,
      hardMiss: true,
      reasons: ['Role is heavy quota cold calling sales; outside demonstrated support and appointment coordination experience.']
    };
  }

  // 3. Proven Winner Cluster for Sister: Real Estate VA / Appointment Setting / Outreach / Lead Qualification
  const isRealEstateOrOutreach = /\b(?:realty|real estate|appointment setter|appointment setting|influencer outreach|outreach specialist|brand outreach|lead qualification|lead coordinator|real estate lead|property management assistant|realty appointment)\b/i.test(title) ||
    (/\b(?:virtual assistant|admin assistant|operations assistant)\b/i.test(title) && /\b(?:real estate|property|booking|scheduling|outreach|lead)\b/i.test(fullText));

  if (isRealEstateOrOutreach) {
    return {
      tier: ClusterTier.PROVEN_WINNER,
      clusterName: 'Real Estate VA & Appointment Setting (Proven Winner)',
      scoreAdjustment: 20,
      hardMiss: false,
      reasons: ['Highest converting historical cluster (100% of Sister\'s 2026 recruiter interview invitations).']
    };
  }

  // 4. Saturated / Dead Cluster for Sister: Generic Data Entry / Broad Call Center / High-Volume Saturated Support
  const isGenericDataEntryOrSaturatedSupport = /\b(?:data entry|data collection|data clerk|typist|customer service representative|call center agent|chat support agent|inbox clerk)\b/i.test(title) &&
    !/\b(?:real estate|appointment|outreach|lead|operations|executive)\b/i.test(fullText);

  if (isGenericDataEntryOrSaturatedSupport) {
    return {
      tier: ClusterTier.FAILED_DEAD_CLUSTER,
      clusterName: 'Generic Data Entry & Saturated Support (Dead Cluster)',
      scoreAdjustment: -25,
      hardMiss: false,
      reasons: ['High competition / saturated role family; 0% interview conversion in 2026 across hundreds of applications.']
    };
  }

  // 5. Selective Fit Cluster for Sister: CRM, Operations Assistant, Executive Support, Scheduling
  const isOperationsOrCrm = /\b(?:crm specialist|hubspot|salesforce|operations assistant|executive assistant|administrative coordinator|onboarding coordinator|client operations|scheduling coordinator|booking assistant)\b/i.test(title) ||
    (/\b(?:operations|administrative|support)\b/i.test(title) && /\b(?:crm|hubspot|salesforce|calendar|client|workflow)\b/i.test(fullText));

  if (isOperationsOrCrm) {
    return {
      tier: ClusterTier.SELECTIVE_FIT,
      clusterName: 'CRM & Operations Coordination (Selective Fit)',
      scoreAdjustment: 10,
      hardMiss: false,
      reasons: ['Solid operational and CRM match with transferable workflow coordination skills.']
    };
  }

  // 6. Social Media & Basic Content Creation: Social media manager, content creator, short-form editing
  const isSocialMediaOrContent = /\b(?:social media|content creator|social media manager|social media coordinator|social media assistant|community manager|reels|tiktok|short-form|content coordinator|social content|social media video)\b/i.test(title);

  if (isSocialMediaOrContent) {
    return {
      tier: ClusterTier.SELECTIVE_FIT,
      clusterName: 'Social Media & Content Creation (Selective Fit)',
      scoreAdjustment: 10,
      hardMiss: false,
      reasons: ['Role matches candidate skills in social media management, content coordination, and basic short-form editing.']
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

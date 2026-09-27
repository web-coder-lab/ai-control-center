import { db } from '../database/db.js';

export interface CostEvaluationResult {
  allowed: boolean;
  isPaid: boolean;
  costEstimate?: string;
  reason?: string;
  freeAlternative?: string;
}

export function evaluateCostPolicy(
  provider: string,
  operation: string,
  params: any = {}
): CostEvaluationResult {
  const settings = db.getSettings();
  const policy = settings.costPolicy || 'ask-before-paid';

  let isPaid = false;
  let costEstimate = '$0.00';
  let reason = '';
  let freeAlternative = '';
  let pricingKnown = false;

  if (provider === 'render') {
    pricingKnown = true;
    const plan = params.plan || params.serviceDetails?.plan || params.serviceDetails?.buildPlan;
    if (plan && plan !== 'free') {
      isPaid = true;
      costEstimate = 'Paid compute plan detected; provider pricing must be checked at the time of the operation.';
      reason = `Render service requested with non-free tier plan: "${plan}".`;
      freeAlternative = 'Check the current Render pricing/free-tier policy before choosing a paid compute plan.';
    }
  }

  if (!pricingKnown && policy === 'free-only') {
    return { allowed: false, isPaid: false, reason: `PAUSED BY COST POLICY (free-only): Pricing for ${provider}/${operation} is not verified by the current connector.`, freeAlternative: 'Connect a provider-specific pricing checker or choose a confirmed free operation.' };
  }

  if (isPaid) {
    if (policy === 'free-only') {
      return {
        allowed: false,
        isPaid: true,
        costEstimate,
        reason: `PAUSED BY COST POLICY (free-only): ${reason} No confirmed free option is available for this operation.`,
        freeAlternative,
      };
    }

    if (policy === 'ask-before-paid' && !params.humanApprovedPayment) {
      return {
        allowed: false,
        isPaid: true,
        costEstimate,
        reason: `APPROVAL REQUIRED: ${reason} Action has been paused pending your authorization.`,
        freeAlternative,
      };
    }
  }

  return {
    allowed: true,
    isPaid,
    costEstimate,
  };
}

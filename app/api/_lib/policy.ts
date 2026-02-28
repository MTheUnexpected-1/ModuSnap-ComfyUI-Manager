export type NodeLicensePolicy = 'open' | 'non-commercial' | 'commercial' | 'unknown';

export type TierEnforcementRule = {
    tier: 'free' | 'pro' | 'enterprise';
    allowedPolicies: NodeLicensePolicy[];
};

export const TIER_RULES: Record<string, TierEnforcementRule> = {
    free: { tier: 'free', allowedPolicies: ['open'] },
    pro: { tier: 'pro', allowedPolicies: ['open', 'non-commercial'] },
    enterprise: { tier: 'enterprise', allowedPolicies: ['open', 'non-commercial', 'commercial'] },
};

export function evaluatePolicy(
    tier: string,
    policies: NodeLicensePolicy[]
): { allowed: boolean; violations: NodeLicensePolicy[] } {
    const rule = TIER_RULES[tier] || TIER_RULES['free']; // default to free
    const violations = policies.filter((p) => !rule!.allowedPolicies.includes(p));
    // Default deny: if any policy is 'unknown' and not explicitly in allowedPolicies, or commercial in free, etc.
    // Actually, 'unknown' is not in any allowedPolicies above, resulting in default deny!
    return {
        allowed: violations.length === 0,
        violations,
    };
}

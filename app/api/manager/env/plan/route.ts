import { NextResponse } from 'next/server';
import { createPlan } from '../../../_lib/managerEnvEngine';
import { NodeLicensePolicy, evaluatePolicy } from '../../../_lib/policy';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const userTier = process.env.MODUSNAP_LICENSE_TIER || 'free';
    const policies: NodeLicensePolicy[] = body?.policies || [];
    const evaluation = evaluatePolicy(userTier, policies);

    if (!evaluation.allowed) {
      return NextResponse.json(
        { ok: false, error: 'Policy Violation', violations: evaluation.violations, hint: `Your current tier (${userTier}) does not permit installing these nodes.` },
        { status: 403 }
      );
    }

    const tx = createPlan({
      mode: body?.mode,
      packages: body?.packages,
      policies,
    });
    return NextResponse.json({ ok: true, transaction: tx });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: 'Failed to create env plan.', details: error?.message || String(error) },
      { status: 500 },
    );
  }
}

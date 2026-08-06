/**
 * Org-level feature gate for AI Compliance Review.
 *
 * The full-package compliance review is a single-org (Horus Technology) feature,
 * mirroring `enablePOCGeneration`. The flag is set manually in DynamoDB (no UI).
 * Enforced server-side in every compliance-review handler so the client gate
 * cannot be bypassed by calling the endpoint directly.
 */
import { getOrganizationById } from '@/helpers/org';

/**
 * Returns true when the AI compliance review feature is enabled for the org.
 */
export const isComplianceReviewEnabled = async (orgId: string): Promise<boolean> => {
  const org = await getOrganizationById(orgId);
  return !!org?.enableComplianceReview;
};

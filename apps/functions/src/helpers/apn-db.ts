/**
 * High-level helper to sync an opportunity to AWS Partner Central.
 * Uses dynamic import to avoid pulling in @aws-sdk/client-partnercentral-selling
 * at module load time. Safe to call from any handler.
 *
 * Stores `apnOpportunityId` and `apnSyncError` directly on the opportunity item —
 * no separate APN_REGISTRATION entity needed.
 */
export const syncOpportunityToApn = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  customerName: string;
  opportunityTitle?: string;
  opportunityValue: number;
  expectedCloseDate: string;
  proposalStatus: string;
  description?: string;
  /** Pass the existing apnOpportunityId to update instead of create */
  existingApnId?: string | null;
}): Promise<void> => {
  console.log(`[syncOpportunityToApn] Starting sync for oppId=${args.oppId} with proposalStatus=${args.proposalStatus}`);
  
  try {
    // Resolve org name for the Partner Central customer company name
    let customerName = args.customerName;
    try {
      const { getOrganizationById } = await import('@/handlers/organization/get-organization-by-id');
      const org = await getOrganizationById(args.orgId);
      if (org?.name) customerName = org.name;
      console.log(`[syncOpportunityToApn] Resolved customer name: ${customerName}`);
    } catch {
      // Fall back to the provided customerName
      console.log(`[syncOpportunityToApn] Using fallback customer name: ${customerName}`);
    }

    const { syncToPartnerCentral } = await import('@/helpers/apn-client');
    console.log(`[syncOpportunityToApn] Calling syncToPartnerCentral with proposalStatus=${args.proposalStatus}`);
    
    await syncToPartnerCentral({
      ...args,
      customerName,
    });
    
    console.log(`[syncOpportunityToApn] Successfully completed sync for oppId=${args.oppId}`);
  } catch (err) {
    console.error(`[syncOpportunityToApn] Failed for oppId=${args.oppId}:`, (err as Error).message);
    console.error(`[syncOpportunityToApn] Full error:`, err);
    throw err; // Re-throw to surface the error
  }
};

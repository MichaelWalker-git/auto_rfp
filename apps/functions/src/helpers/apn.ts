/**
 * Re-export barrel for APN (AWS Partner Network) integration.
 *
 * syncOpportunityToApn — high-level helper that resolves org name + calls Partner Central API.
 * syncToPartnerCentral — low-level Partner Central SDK wrapper (in apn-client.ts).
 *
 * APN sync stores `apnOpportunityId` and `apnSyncError` directly on the opportunity item.
 */

export { syncOpportunityToApn } from '@/helpers/apn-db';
export { syncToPartnerCentral } from '@/helpers/apn-client';
export type { SyncToApnArgs } from '@/helpers/apn-client';

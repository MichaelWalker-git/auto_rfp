/**
 * Related-RFP constants (HOR-2610).
 */

export const RELATED_RFP_PK = 'RELATED_RFP' as const;
export const RELATED_RFP_SUPPRESSION_PK = 'RELATED_RFP_SUPPRESSION' as const;

/** Max auto-linked related RFPs kept per opportunity (conscious tight floor for v1). */
export const MAX_AUTO_RELATED = 5;

/** Minimum relevance score (0..1) for an auto match to be kept. */
export const RELATED_MATCH_THRESHOLD = 0.15;

/** Page size to pull from HigherGov before client-side ranking. */
export const AGENCY_FETCH_PAGE_SIZE = 100;

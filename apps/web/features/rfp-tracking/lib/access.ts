/**
 * RFP Tracking is a single-org feature (Horus Tech). The org it is enabled for
 * is stage-specific and injected at build time via `NEXT_PUBLIC_RFP_TRACKING_ORG_ID`
 * (set per Amplify branch in the CDK AmplifyFeStack). When the var is unset the
 * feature is hidden everywhere — that is the safe default.
 */
export const RFP_TRACKING_ORG_ID = process.env.NEXT_PUBLIC_RFP_TRACKING_ORG_ID ?? '';

/**
 * Whether the RFP tracking dashboard should be available for the given org.
 * Gates both the sidebar nav entry and the page route.
 */
export const isRfpTrackingEnabledForOrg = (orgId: string | null | undefined): boolean =>
  !!orgId && !!RFP_TRACKING_ORG_ID && orgId === RFP_TRACKING_ORG_ID;

export const APN_REGISTRATION_PK = 'APN_REGISTRATION' as const;
export const APN_SECRET_PREFIX    = 'apn' as const;

/** Metadata record that stores non-secret credential info (partnerId, region, configuredAt) */
export const APN_CREDENTIALS_PK  = 'APN_CREDENTIALS' as const;

/** AWS Partner Central API base URL */
export const APN_PARTNER_CENTRAL_BASE_URL =
  'https://partnercentral.awspartner.com/api/v1';

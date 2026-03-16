export const APN_REGISTRATION_PK = 'APN_REGISTRATION' as const;

/** AWS Partner Central Selling API catalog — always 'AWS' */
export const APN_CATALOG = 'AWS' as const;

/**
 * Maps internal opportunity stages to AWS Partner Central proposal statuses.
 * Used across create, update, and stage transition flows.
 */
export const STAGE_TO_APN_STATUS_MAP: Record<string, string> = {
  IDENTIFIED:  'PROSPECT',
  QUALIFYING:  'PROSPECT',
  PURSUING:    'PROSPECT',
  SUBMITTED:   'SUBMITTED',
  WON:         'WON',
  LOST:        'LOST',
  NO_BID:      'LOST',
  WITHDRAWN:   'LOST',
} as const;

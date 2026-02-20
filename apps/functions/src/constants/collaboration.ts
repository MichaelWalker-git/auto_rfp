export const PK = {
  PRESENCE: 'PRESENCE',
  COMMENT: 'COMMENT',
  ASSIGNMENT: 'ASSIGNMENT',
  ACTIVITY: 'ACTIVITY',
  WS_CONNECTION: 'WS_CONNECTION',
} as const;

export const PRESENCE_TTL_SECONDS = 90;        // 30s heartbeat × 3 = 90s grace
export const ACTIVITY_TTL_DAYS = 90;
export const WS_CONNECTION_TTL_SECONDS = 7200; // 2 hours max session

export const RFP_DIGEST_TEAM_ID = '014ad7fc-6875-4a34-973b-61d029c37116';
export const RFP_DIGEST_PROJECT_ID = '823d8281-c41e-4e00-b541-f31a5c91af46';

export const SLACK_WEBHOOK_SECRET_PREFIX = 'slack-webhook';

/** Workflow statuses on the Government Contracting board. */
export const RFP_STATUS = {
  TODO: 'Todo',
  BACKLOG: 'Backlog',
  TO_BE_REVIEWED: 'To be Reviewed',
  REVIEWED_APPROVED: 'Reviewed - Approved',
  REVIEWED_NOT_APPROVED: 'Reviewed / Not Approved',
  IN_PROGRESS: 'In Progress',
  SUBMITTED: 'Submitted',
  AWARDED: 'Awarded',
} as const;

/**
 * Approval gates exist only as labels — the board has no status for stages 5 and 6 —
 * so stage resolution has to read labels as well as status.
 */
export const RFP_LABEL = {
  FIRST_APPROVED: 'I Approved',
  SECOND_APPROVED: 'II Approved',
  PRE_SUB_APPROVAL: 'Pre Sub Approval',
  DID_NOT_WIN: 'dnw',
  SKIP: 'skip',
  /** Deadline passed while still open — dead, but often left in an open status. */
  EXPIRED: 'expired',
  CANCELLED_BID: 'Cancelled Bid',
} as const;

/**
 * Statuses that are not part of the RFP lifecycle and must not be counted.
 * `Todo` is here because on this board it holds internal admin and training
 * tickets (AWS certifications, training videos), not sourced opportunities —
 * new RFPs land straight in `To be Reviewed`.
 */
export const RFP_NON_LIFECYCLE_STATUSES: readonly string[] = [
  'Todo',
  'Done',
  'Duplicate',
  'Important Information',
  'Task checklist',
];

/**
 * Internal admin/report tickets that live on the RFP board but are not RFPs.
 * They carry no `skip` label, so they would otherwise inflate the funnel —
 * HOR-2073 is a status-report container, HOR-1488 a documentation task.
 */
export const RFP_EXCLUDED_IDENTIFIERS: readonly string[] = ['HOR-2073', 'HOR-1488'];

/**
 * Issue identifiers are posted as explicit links rather than bare `HOR-1234`
 * tokens: the Linear Slack app auto-replies in-thread to every bare identifier
 * it sees, which buried each digest under a stack of empty replies.
 */
export const LINEAR_ISSUE_URL_BASE = 'https://linear.app/horustech/issue';

/** Always shown in the per-person section, even at zero. */
export const RFP_TRACKED_PEOPLE: readonly string[] = ['Brennen Stones', 'Jhoan Santamaria'];

/**
 * Slack user IDs, keyed by Linear display name, used to @-mention each tracked
 * person on their own update post. A missing entry falls back to plain text.
 */
export const RFP_SLACK_USER_IDS: Record<string, string> = {
  'Brennen Stones': 'U097XHX6Q2J',
  'Jhoan Santamaria': 'U098C1UPBB9',
  'Michael Walker': 'U03DJAC3QH4',
};

/**
 * Who owns each approval gate in the "Blocked waiting on an approval" section:
 * the first review gate (exec summary) is Brennen's, the pre-submission gate is
 * Michael's. Values are Slack user IDs for `<@ID>` mentions.
 */
export const RFP_APPROVER_SLACK_IDS = {
  INITIAL: 'U097XHX6Q2J', // Brennen Stones — first review of the exec summary
  PRE_SUBMISSION: 'U03DJAC3QH4', // Michael Walker — final sign-off before submission
} as const;

export const RFP_TERMINAL_WINDOW_DAYS = 30;
export const RFP_DIGEST_MAX_ROWS = 8;

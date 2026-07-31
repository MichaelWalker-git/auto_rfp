import {
  RFP_DIGEST_OPEN_STAGES,
  RFP_DIGEST_STANDING_STAGES,
  type RfpDigest,
  type RfpDigestIssue,
  type RfpDigestIssueRef,
  type RfpDigestRow,
  type RfpInProgressGroup,
  type RfpPersonProgress,
  type RfpPipelineStage,
  type RfpStageCounts,
} from '@auto-rfp/core';
import {
  LINEAR_ISSUE_URL_BASE,
  RFP_APPROVER_SLACK_IDS,
  RFP_DIGEST_MAX_ROWS,
  RFP_EXCLUDED_IDENTIFIERS,
  RFP_LABEL,
  RFP_NON_LIFECYCLE_STATUSES,
  RFP_SLACK_USER_IDS,
  RFP_STATUS,
  RFP_TERMINAL_WINDOW_DAYS,
  RFP_TRACKED_PEOPLE,
} from '@/constants/rfp-digest';

const DAY_MS = 24 * 60 * 60 * 1000;
const TITLE_MAX_CHARS = 60;

const STAGE_LABELS: Record<RfpPipelineStage, string> = {
  found: 'Found',
  execSummaryToReview: 'Exec summary, to be reviewed',
  firstApproved: 'First approved',
  notApproved: 'Not approved',
  inProgress: 'In progress',
  preSubmissionReview: 'Pre-submission review',
  secondApproved: 'Second approved',
  submitted: 'Submitted',
  awarded: 'Awarded',
  lost: 'Lost',
  expired: 'Expired',
};

/**
 * Ordered, first-match-wins. Order is load-bearing: gate labels are additive and
 * never removed (a Submitted issue still carries `I Approved`), and ~15% of issues
 * carry labels that contradict their status. Stages 5 and 6 exist only as labels.
 */
export const resolveStage = (issue: RfpDigestIssue): RfpPipelineStage | null => {
  const { status, labels } = issue;
  const has = (label: string) => labels.includes(label);

  if (status === RFP_STATUS.AWARDED) return has(RFP_LABEL.DID_NOT_WIN) ? 'lost' : 'awarded';
  if (status === RFP_STATUS.SUBMITTED) return 'submitted';
  if (status === RFP_STATUS.REVIEWED_NOT_APPROVED) return 'notApproved';
  // Checked after the real outcomes but before the open stages: a passed deadline
  // kills an in-flight bid, but it doesn't rewrite one that already resolved.
  if (has(RFP_LABEL.EXPIRED)) return 'expired';
  if (has(RFP_LABEL.SECOND_APPROVED)) return 'secondApproved';
  if (has(RFP_LABEL.PRE_SUB_APPROVAL)) return 'preSubmissionReview';
  if (status === RFP_STATUS.IN_PROGRESS) return 'inProgress';
  if (status === RFP_STATUS.REVIEWED_APPROVED || has(RFP_LABEL.FIRST_APPROVED)) return 'firstApproved';
  if (status === RFP_STATUS.TO_BE_REVIEWED) return 'execSummaryToReview';
  if (status === RFP_STATUS.TODO || status === RFP_STATUS.BACKLOG) return 'found';

  return null;
};

/** Retired rows and non-lifecycle tickets would otherwise be counted as RFPs. */
export const isTrackedIssue = (issue: RfpDigestIssue): boolean =>
  !issue.labels.includes(RFP_LABEL.SKIP) &&
  !RFP_NON_LIFECYCLE_STATUSES.includes(issue.status) &&
  !RFP_EXCLUDED_IDENTIFIERS.includes(issue.identifier);

const parseDate = (value?: string): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const truncateTitle = (title: string): string =>
  title.length <= TITLE_MAX_CHARS ? title : `${title.slice(0, TITLE_MAX_CHARS - 1).trimEnd()}…`;

const toRef = (issue: RfpDigestIssue): RfpDigestIssueRef => ({
  identifier: issue.identifier,
  title: truncateTitle(issue.title),
});

const isOpenStage = (stage: RfpPipelineStage): boolean =>
  (RFP_DIGEST_OPEN_STAGES as readonly RfpPipelineStage[]).includes(stage);

const isStandingStage = (stage: RfpPipelineStage): boolean =>
  (RFP_DIGEST_STANDING_STAGES as readonly RfpPipelineStage[]).includes(stage);

/**
 * Open and standing stages count everything; terminal stages only count the
 * recent window, because lifetime terminal totals are dominated by years of
 * closed work (Submitted is 163 all-time vs 14 in 30 days).
 */
export const buildStageCounts = (issues: RfpDigestIssue[], now: Date): RfpStageCounts => {
  const terminalCutoff = new Date(now.getTime() - RFP_TERMINAL_WINDOW_DAYS * DAY_MS);
  const counts: RfpStageCounts = {};

  for (const issue of issues) {
    const stage = resolveStage(issue);
    if (!stage) continue;

    if (!isOpenStage(stage) && !isStandingStage(stage)) {
      const closedAt = parseDate(issue.completedAt) ?? parseDate(issue.updatedAt);
      if (!closedAt || closedAt < terminalCutoff) continue;
    }

    counts[stage] = (counts[stage] ?? 0) + 1;
  }

  return counts;
};

const inWindow = (value: string | undefined, since: Date): boolean => {
  const parsed = parseDate(value);
  return !!parsed && parsed >= since;
};

export const buildPersonProgress = (
  issues: RfpDigestIssue[],
  name: string,
  since: Date,
): RfpPersonProgress => {
  const assigned = issues.filter((issue) => issue.assigneeName === name);

  const openByStage: RfpStageCounts = {};
  for (const issue of assigned) {
    const stage = resolveStage(issue);
    if (stage && isOpenStage(stage)) openByStage[stage] = (openByStage[stage] ?? 0) + 1;
  }

  return {
    name,
    submitted: assigned
      .filter((issue) => resolveStage(issue) === 'submitted' && inWindow(issue.completedAt, since))
      .map(toRef),
    // No completion timestamp exists for `Reviewed / Not Approved`, so this is
    // inferred from updatedAt and can catch a late edit to an older no-go.
    noGo: assigned
      .filter((issue) => resolveStage(issue) === 'notApproved' && inWindow(issue.updatedAt, since))
      .map(toRef),
    started: assigned.filter((issue) => inWindow(issue.startedAt, since)).map(toRef),
    sourced: issues
      .filter((issue) => issue.creatorName === name && inWindow(issue.createdAt, since))
      .map(toRef),
    openByStage,
  };
};

/** Tracked people always appear; anyone else appears only if they moved something. */
export const collectPeople = (issues: RfpDigestIssue[], since: Date): RfpPersonProgress[] => {
  const names = new Set<string>(RFP_TRACKED_PEOPLE);

  for (const issue of issues) {
    const movedInWindow =
      inWindow(issue.completedAt, since) ||
      inWindow(issue.startedAt, since) ||
      inWindow(issue.createdAt, since);
    if (!movedInWindow) continue;
    if (issue.assigneeName) names.add(issue.assigneeName);
    if (issue.creatorName) names.add(issue.creatorName);
  }

  const progress = [...names].map((name) => buildPersonProgress(issues, name, since));
  const movementCount = (person: RfpPersonProgress) =>
    person.submitted.length + person.noGo.length + person.started.length + person.sourced.length;

  return progress
    .filter((person) => RFP_TRACKED_PEOPLE.includes(person.name) || movementCount(person) > 0)
    .sort((a, b) => movementCount(b) - movementCount(a));
};

/**
 * A live snapshot of what each person is actively working: every issue currently
 * in the In Progress stage, grouped by assignee. Unlike the per-person movement
 * section, this is not windowed — work started weeks ago still shows if it is
 * still In Progress. Unassigned In Progress issues are dropped (no one to list
 * them under). Groups are ordered by size, then name, for a stable render.
 */
export const buildInProgress = (issues: RfpDigestIssue[]): RfpInProgressGroup[] => {
  const byName = new Map<string, RfpDigestIssueRef[]>();

  for (const issue of issues) {
    if (resolveStage(issue) !== 'inProgress' || !issue.assigneeName) continue;
    const items = byName.get(issue.assigneeName) ?? [];
    items.push(toRef(issue));
    byName.set(issue.assigneeName, items);
  }

  return [...byName.entries()]
    .map(([name, items]) => ({ name, items }))
    .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
};

const ageInDays = (issue: RfpDigestIssue, now: Date): number | undefined => {
  const updated = parseDate(issue.updatedAt);
  if (!updated) return undefined;
  return Math.max(0, Math.floor((now.getTime() - updated.getTime()) / DAY_MS));
};

export const buildAwaitingApproval = (issues: RfpDigestIssue[], now: Date): RfpDigestRow[] =>
  issues
    .flatMap((issue) => {
      const stage = resolveStage(issue);
      if (stage !== 'execSummaryToReview' && stage !== 'preSubmissionReview') return [];
      return [
        {
          identifier: issue.identifier,
          title: truncateTitle(issue.title),
          assigneeName: issue.assigneeName,
          ageDays: ageInDays(issue, now),
          stage,
        },
      ];
    })
    .sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));

export const buildDigest = (
  rawIssues: RfpDigestIssue[],
  now: Date,
  windowDays: number,
): RfpDigest => {
  const issues = rawIssues.filter(isTrackedIssue);
  const since = new Date(now.getTime() - windowDays * DAY_MS);

  const awaitingApproval = buildAwaitingApproval(issues, now);

  return {
    generatedAt: now.toISOString(),
    windowDays,
    stageCounts: buildStageCounts(issues, now),
    people: collectPeople(issues, since),
    inProgress: buildInProgress(issues),
    awaitingApproval: awaitingApproval.slice(0, RFP_DIGEST_MAX_ROWS),
    awaitingApprovalTotal: awaitingApproval.length,
  };
};

/** Live inventory — every open issue, no age cutoff. */
const OPEN_FUNNEL_ORDER: RfpPipelineStage[] = [
  'execSummaryToReview',
  'firstApproved',
  'inProgress',
  'preSubmissionReview',
  'secondApproved',
];

/** Throughput — only what closed inside the terminal window. */
const CLOSED_FUNNEL_ORDER: RfpPipelineStage[] = ['submitted', 'notApproved', 'awarded', 'lost'];

const FUNNEL_ORDER: RfpPipelineStage[] = [...OPEN_FUNNEL_ORDER, ...CLOSED_FUNNEL_ORDER];

/**
 * Some Linear accounts have an email address as their display name; Slack would
 * auto-link it into a mailto, so show the local part instead.
 */
const formatOwner = (assigneeName?: string): string => {
  if (!assigneeName) return 'unassigned';
  const [localPart] = assigneeName.split('@');
  return localPart ?? assigneeName;
};

/**
 * Slack link syntax, not a bare identifier: the Linear app watches for bare
 * `HOR-1234` tokens and posts an in-thread reply for each one it finds.
 */
const formatIssueLink = (identifier: string): string =>
  `<${LINEAR_ISSUE_URL_BASE}/${identifier}|${identifier}>`;

/**
 * Slack strips leading ASCII spaces, which flattened every nested line to the
 * left margin. Non-breaking spaces survive, so indentation is built from those.
 */
const INDENT = '\u00A0'.repeat(4);

const formatRefs = (refs: RfpDigestIssueRef[]): string[] =>
  refs.map((ref) => `${INDENT}${INDENT}• ${formatIssueLink(ref.identifier)} ${ref.title}`);

/** Single-indent bullet list — one level shallower than {@link formatRefs}. */
const formatTopLevelRefs = (refs: RfpDigestIssueRef[]): string[] =>
  refs.map((ref) => `${INDENT}• ${formatIssueLink(ref.identifier)} ${ref.title}`);

/** Aggregate open-work summary, e.g. "6 first approved · 2 in progress". */
const formatOpenQueue = (openByStage: RfpStageCounts): string => {
  const parts = OPEN_FUNNEL_ORDER.filter((stage) => openByStage[stage]).map(
    (stage) => `${openByStage[stage]} ${STAGE_LABELS[stage].toLowerCase()}`,
  );
  return parts.length ? parts.join(' · ') : 'nothing open';
};

/** Slack `<@ID>` mention when the name is known, otherwise a bold plain name. */
const formatMention = (name: string): string => {
  const id = RFP_SLACK_USER_IDS[name];
  return id ? `<@${id}>` : `*${name}*`;
};

/**
 * Who to ping for a blocked row: the first review gate is Brennen's, the
 * pre-submission gate is Michael's. Anything else (shouldn't happen) is silent.
 */
const approverMention = (stage: RfpPipelineStage): string | null => {
  if (stage === 'execSummaryToReview') return `<@${RFP_APPROVER_SLACK_IDS.INITIAL}>`;
  if (stage === 'preSubmissionReview') return `<@${RFP_APPROVER_SLACK_IDS.PRE_SUBMISSION}>`;
  return null;
};

const formatHeading = (now: Date): string =>
  now.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });

/**
 * The day the current window opened, named by weekday — e.g. "Monday, Jul 21".
 * Thursday's digest looks back to Monday; Monday's looks back to Thursday, so
 * naming the day reads more naturally than "the last N days".
 */
const formatSinceDay = (now: Date, windowDays: number): string => {
  const since = new Date(now.getTime() - windowDays * DAY_MS);
  return since.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'America/Los_Angeles',
  });
};

/** One person's activity block within the digest, @-mentioning them. */
const formatPersonSection = (person: RfpPersonProgress): string[] => {
  const lines: string[] = [
    `${formatMention(person.name)} — submitted ${person.submitted.length} · no-go ${person.noGo.length} · started ${person.started.length} · sourced ${person.sourced.length}`,
  ];

  if (person.submitted.length) {
    lines.push(`${INDENT}*Submitted:*`, ...formatRefs(person.submitted));
  }
  if (person.started.length) {
    lines.push(`${INDENT}*Started:*`, ...formatRefs(person.started));
  }
  if (person.noGo.length) {
    lines.push(`${INDENT}*No-go:*`, ...formatRefs(person.noGo));
  }
  if (person.sourced.length) {
    lines.push(`${INDENT}*Sourced:*`, ...formatRefs(person.sourced));
  }
  lines.push(`${INDENT}*Open:* ${formatOpenQueue(person.openByStage)}`);

  return lines;
};

/**
 * The whole digest as a single Slack message: what's blocked on an approval
 * (each row pinging the approver who owns that gate), the funnel counts, then
 * each tracked person's activity block (@-mentioning them).
 */
export const formatSlackMessage = (digest: RfpDigest, now: Date): string => {
  const count = (stage: RfpPipelineStage) => digest.stageCounts[stage] ?? 0;
  const openTotal = OPEN_FUNNEL_ORDER.reduce((sum, stage) => sum + count(stage), 0);

  const lines: string[] = [`*RFP Pipeline — ${formatHeading(now)}*`];

  // First, because it is the only section that asks someone to do something today.
  if (digest.awaitingApproval.length) {
    lines.push('', '*Blocked waiting on an approval*');
    for (const row of digest.awaitingApproval) {
      const owner = formatOwner(row.assigneeName);
      const approver = approverMention(row.stage);
      const suffix = approver ? ` — ${approver} to approve` : '';
      lines.push(
        `${formatIssueLink(row.identifier)} ${row.title} — ${owner}, ${row.ageDays ?? 0}d${suffix}`,
      );
    }
    if (digest.awaitingApprovalTotal > digest.awaitingApproval.length) {
      lines.push(`+${digest.awaitingApprovalTotal - digest.awaitingApproval.length} more`);
    }
  }

  lines.push('', `*Open right now — ${openTotal} live bids*`);
  for (const stage of OPEN_FUNNEL_ORDER) {
    lines.push(`${STAGE_LABELS[stage]} · ${count(stage)}`);
  }
  if (count('expired')) {
    lines.push(`${STAGE_LABELS.expired} · ${count('expired')}   (deadline passed, needs closing out)`);
  }

  lines.push('', `*Closed in the last ${RFP_TERMINAL_WINDOW_DAYS} days*`);
  for (const stage of CLOSED_FUNNEL_ORDER) {
    lines.push(`${STAGE_LABELS[stage]} · ${count(stage)}`);
  }

  // Live board snapshot of active work, so bids started before the window but
  // still being worked are named — not just collapsed into an "in progress" count.
  // Plain bold names, not @-mentions: these people are usually pinged just below.
  if (digest.inProgress.length) {
    lines.push('', '*In progress right now*');
    for (const group of digest.inProgress) {
      lines.push(`*${group.name}*`, ...formatTopLevelRefs(group.items));
    }
  }

  lines.push('', `*What each person moved since ${formatSinceDay(now, digest.windowDays)}*`);
  for (const person of digest.people) {
    lines.push(...formatPersonSection(person));
  }

  lines.push('', '_No Lost / No Response status on the board; losses are inferred from the `dnw` label._');

  return lines.join('\n');
};

import type { RfpDigestIssue } from '@auto-rfp/core';
import {
  buildAwaitingApproval,
  buildDigest,
  buildPersonProgress,
  buildStageCounts,
  collectPeople,
  formatSlackMessage,
  isTrackedIssue,
  resolveStage,
} from './rfp-digest.service';

const NOW = new Date('2026-07-27T18:00:00Z');

const issue = (overrides: Partial<RfpDigestIssue> = {}): RfpDigestIssue => ({
  identifier: 'HOR-1',
  title: 'Website Redesign',
  status: 'Reviewed - Approved',
  labels: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-26T00:00:00.000Z',
  ...overrides,
});

describe('resolveStage', () => {
  it('maps each status to its canonical stage', () => {
    expect(resolveStage(issue({ status: 'Todo' }))).toBe('found');
    expect(resolveStage(issue({ status: 'Backlog' }))).toBe('found');
    expect(resolveStage(issue({ status: 'To be Reviewed' }))).toBe('execSummaryToReview');
    expect(resolveStage(issue({ status: 'Reviewed - Approved' }))).toBe('firstApproved');
    expect(resolveStage(issue({ status: 'Reviewed / Not Approved' }))).toBe('notApproved');
    expect(resolveStage(issue({ status: 'In Progress' }))).toBe('inProgress');
    expect(resolveStage(issue({ status: 'Submitted' }))).toBe('submitted');
    expect(resolveStage(issue({ status: 'Awarded' }))).toBe('awarded');
  });

  it('splits Awarded into lost when the dnw label is present', () => {
    expect(resolveStage(issue({ status: 'Awarded', labels: ['dnw'] }))).toBe('lost');
  });

  it('resolves stages 5 and 6 from labels, since no status exists for them', () => {
    expect(resolveStage(issue({ status: 'Todo', labels: ['Pre Sub Approval'] }))).toBe('preSubmissionReview');
    expect(resolveStage(issue({ status: 'Todo', labels: ['II Approved'] }))).toBe('secondApproved');
  });

  it('prefers terminal status over additive gate labels', () => {
    // Gate labels are never removed, so a submitted issue still carries them.
    const submitted = issue({ status: 'Submitted', labels: ['I Approved', 'II Approved'] });
    expect(resolveStage(submitted)).toBe('submitted');

    const noGo = issue({ status: 'Reviewed / Not Approved', labels: ['I Approved'] });
    expect(resolveStage(noGo)).toBe('notApproved');
  });

  it('treats a first-approval label as stage 3a when the status lags behind', () => {
    expect(resolveStage(issue({ status: 'To be Reviewed', labels: ['I Approved'] }))).toBe('firstApproved');
  });

  it('returns null for statuses outside the RFP lifecycle', () => {
    expect(resolveStage(issue({ status: 'Done' }))).toBeNull();
    expect(resolveStage(issue({ status: 'Unknown Status' }))).toBeNull();
  });
});

describe('isTrackedIssue', () => {
  it('drops retired rows and non-lifecycle tickets', () => {
    expect(isTrackedIssue(issue({ labels: ['skip'] }))).toBe(false);
    expect(isTrackedIssue(issue({ status: 'Done' }))).toBe(false);
    expect(isTrackedIssue(issue({ status: 'Task checklist' }))).toBe(false);
    expect(isTrackedIssue(issue())).toBe(true);
  });

  it('drops Todo, which holds admin and training tickets rather than RFPs', () => {
    expect(isTrackedIssue(issue({ status: 'Todo' }))).toBe(false);
  });

  it('drops admin tickets that carry no skip label', () => {
    // Status-report and documentation tickets that would otherwise inflate the funnel.
    expect(isTrackedIssue(issue({ identifier: 'HOR-2073' }))).toBe(false);
    expect(isTrackedIssue(issue({ identifier: 'HOR-1488' }))).toBe(false);
  });
});

describe('expired handling', () => {
  it('resolves an expired label to its own stage instead of an open one', () => {
    expect(resolveStage(issue({ status: 'Reviewed - Approved', labels: ['expired'] }))).toBe('expired');
  });

  it('keeps a real outcome ahead of the expired label', () => {
    expect(resolveStage(issue({ status: 'Submitted', labels: ['expired'] }))).toBe('submitted');
    expect(resolveStage(issue({ status: 'Reviewed / Not Approved', labels: ['expired'] }))).toBe('notApproved');
  });

  it('keeps expired out of the open counts but still reports it', () => {
    const counts = buildStageCounts(
      [issue({ status: 'Reviewed - Approved', labels: ['expired'], updatedAt: '2024-01-01T00:00:00.000Z' })],
      NOW,
    );
    expect(counts.firstApproved).toBeUndefined();
    // Standing, not windowed — a years-old expiry still needs closing out.
    expect(counts.expired).toBe(1);
  });
});

describe('buildStageCounts', () => {
  it('counts every open-stage issue regardless of age', () => {
    const counts = buildStageCounts(
      [issue({ status: 'Reviewed - Approved', updatedAt: '2024-01-01T00:00:00.000Z' })],
      NOW,
    );
    expect(counts.firstApproved).toBe(1);
  });

  it('counts terminal issues only inside the 30-day window', () => {
    const recent = issue({ identifier: 'HOR-2', status: 'Submitted', completedAt: '2026-07-20T00:00:00.000Z' });
    const stale = issue({ identifier: 'HOR-3', status: 'Submitted', completedAt: '2026-01-01T00:00:00.000Z' });
    expect(buildStageCounts([recent, stale], NOW).submitted).toBe(1);
  });

  it('falls back to updatedAt when a terminal issue has no completedAt', () => {
    const noGo = issue({ status: 'Reviewed / Not Approved', updatedAt: '2026-07-25T00:00:00.000Z' });
    expect(buildStageCounts([noGo], NOW).notApproved).toBe(1);
  });

  it('ignores issues that resolve to no stage', () => {
    expect(buildStageCounts([issue({ status: 'Done' })], NOW)).toEqual({});
  });
});

describe('buildPersonProgress', () => {
  const since = new Date('2026-07-23T18:00:00Z');

  it('counts submissions, no-gos, starts and sourced work inside the window', () => {
    const issues = [
      issue({
        identifier: 'HOR-10',
        status: 'Submitted',
        assigneeName: 'Jhoan Santamaria',
        completedAt: '2026-07-25T00:00:00.000Z',
      }),
      issue({
        identifier: 'HOR-11',
        status: 'Reviewed / Not Approved',
        assigneeName: 'Jhoan Santamaria',
        updatedAt: '2026-07-26T00:00:00.000Z',
      }),
      issue({
        identifier: 'HOR-12',
        status: 'In Progress',
        assigneeName: 'Jhoan Santamaria',
        startedAt: '2026-07-24T00:00:00.000Z',
      }),
      issue({
        identifier: 'HOR-13',
        creatorName: 'Jhoan Santamaria',
        assigneeName: 'Brennen Stones',
        createdAt: '2026-07-25T00:00:00.000Z',
      }),
    ];

    const progress = buildPersonProgress(issues, 'Jhoan Santamaria', since);
    expect(progress.submitted.map((r) => r.identifier)).toEqual(['HOR-10']);
    expect(progress.noGo.map((r) => r.identifier)).toEqual(['HOR-11']);
    expect(progress.started.map((r) => r.identifier)).toEqual(['HOR-12']);
    expect(progress.sourced.map((r) => r.identifier)).toEqual(['HOR-13']);
  });

  it('excludes transitions that happened before the window', () => {
    const old = issue({
      status: 'Submitted',
      assigneeName: 'Jhoan Santamaria',
      completedAt: '2026-07-01T00:00:00.000Z',
    });
    expect(buildPersonProgress([old], 'Jhoan Santamaria', since).submitted).toEqual([]);
  });

  it('reports the open queue by stage, ignoring terminal work', () => {
    const issues = [
      issue({ identifier: 'HOR-20', status: 'Reviewed - Approved', assigneeName: 'Brennen Stones' }),
      issue({ identifier: 'HOR-21', status: 'Reviewed - Approved', assigneeName: 'Brennen Stones' }),
      issue({ identifier: 'HOR-22', status: 'Submitted', assigneeName: 'Brennen Stones' }),
    ];
    const progress = buildPersonProgress(issues, 'Brennen Stones', since);
    expect(progress.openByStage).toEqual({ firstApproved: 2 });
  });

  it('includes titles alongside the identifiers', () => {
    const issues = [
      issue({
        identifier: 'HOR-30',
        title: 'Student Information System',
        status: 'Submitted',
        assigneeName: 'Jhoan Santamaria',
        completedAt: '2026-07-25T00:00:00.000Z',
      }),
    ];
    expect(buildPersonProgress(issues, 'Jhoan Santamaria', since).submitted[0]).toEqual({
      identifier: 'HOR-30',
      title: 'Student Information System',
    });
  });

  it('truncates long RFP titles', () => {
    const longTitle =
      'Website Design, Development, Hosting Solution, and Content Management System for the County';
    const issues = [
      issue({
        identifier: 'HOR-31',
        title: longTitle,
        status: 'Submitted',
        assigneeName: 'Jhoan Santamaria',
        completedAt: '2026-07-25T00:00:00.000Z',
      }),
    ];
    const { title } = buildPersonProgress(issues, 'Jhoan Santamaria', since).submitted[0];
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('collectPeople', () => {
  const since = new Date('2026-07-23T18:00:00Z');

  it('always includes the tracked people, even with no movement', () => {
    const names = collectPeople([], since).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['Brennen Stones', 'Jhoan Santamaria']));
  });

  it('includes other people only when they moved something in the window', () => {
    const issues = [
      issue({
        identifier: 'HOR-40',
        status: 'Submitted',
        assigneeName: 'Dave Ricks',
        completedAt: '2026-07-25T00:00:00.000Z',
      }),
      issue({
        identifier: 'HOR-41',
        status: 'Submitted',
        assigneeName: 'Idle Person',
        completedAt: '2026-01-01T00:00:00.000Z',
      }),
    ];
    const names = collectPeople(issues, since).map((p) => p.name);
    expect(names).toContain('Dave Ricks');
    expect(names).not.toContain('Idle Person');
  });

  it('sorts the most active person first', () => {
    const issues = [
      issue({
        identifier: 'HOR-50',
        status: 'Submitted',
        assigneeName: 'Jhoan Santamaria',
        completedAt: '2026-07-25T00:00:00.000Z',
      }),
      issue({
        identifier: 'HOR-51',
        status: 'Submitted',
        assigneeName: 'Jhoan Santamaria',
        completedAt: '2026-07-26T00:00:00.000Z',
      }),
      issue({
        identifier: 'HOR-52',
        status: 'Submitted',
        assigneeName: 'Brennen Stones',
        completedAt: '2026-07-25T00:00:00.000Z',
      }),
    ];
    expect(collectPeople(issues, since)[0].name).toBe('Jhoan Santamaria');
  });
});

describe('buildAwaitingApproval', () => {
  it('lists both approval gates, oldest first', () => {
    const issues = [
      issue({ identifier: 'HOR-60', status: 'To be Reviewed', updatedAt: '2026-07-25T00:00:00.000Z' }),
      issue({ identifier: 'HOR-61', status: 'Todo', labels: ['Pre Sub Approval'], updatedAt: '2026-07-10T00:00:00.000Z' }),
      issue({ identifier: 'HOR-62', status: 'Submitted' }),
    ];
    const rows = buildAwaitingApproval(issues, NOW);
    expect(rows.map((r) => r.identifier)).toEqual(['HOR-61', 'HOR-60']);
    expect(rows[0].ageDays).toBe(17);
  });
});

describe('buildDigest', () => {
  it('caps the row lists and reports the untruncated totals', () => {
    const issues = Array.from({ length: 12 }, (_, index) =>
      issue({
        identifier: `HOR-${100 + index}`,
        status: 'To be Reviewed',
        updatedAt: `2026-07-${String(10 + index).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    const digest = buildDigest(issues, NOW, 4);
    expect(digest.awaitingApproval).toHaveLength(8);
    expect(digest.awaitingApprovalTotal).toBe(12);
  });

  it('excludes skipped issues from every section', () => {
    const digest = buildDigest([issue({ status: 'Reviewed - Approved', labels: ['skip'] })], NOW, 4);
    expect(digest.stageCounts).toEqual({});
  });
});

describe('formatSlackMessage', () => {
  const digest = () =>
    buildDigest(
      [
        issue({
          identifier: 'HOR-80',
          title: 'Student Information System',
          status: 'Submitted',
          assigneeName: 'Jhoan Santamaria',
          completedAt: '2026-07-25T00:00:00.000Z',
        }),
        issue({ identifier: 'HOR-81', status: 'Awarded', labels: ['dnw'], updatedAt: '2026-07-25T00:00:00.000Z' }),
      ],
      NOW,
      4,
    );

  it('renders the funnel, per-person titles and the loss caveat', () => {
    const message = formatSlackMessage(digest(), NOW);
    expect(message).toContain('*RFP Pipeline — Mon, Jul 27*');
    expect(message).toContain('*Jhoan Santamaria*');
    expect(message).toContain('Student Information System');
    expect(message).toContain('Brennen Stones');
    expect(message).toContain('Lost · 1');
    expect(message).toContain('dnw');
  });

  it('separates live inventory from windowed throughput', () => {
    // The two must never share a list — 23 open is all-time, 47 not-approved is 30d.
    const message = formatSlackMessage(digest(), NOW);
    expect(message).toContain('*Open right now —');
    expect(message).toContain('*Closed in the last 30 days*');
  });

  it('states the reporting window', () => {
    expect(formatSlackMessage(digest(), NOW)).toContain('*What each person moved in the last 4 days*');
  });

  it('links issue identifiers instead of emitting bare tokens', () => {
    // Bare `HOR-80` would make the Linear Slack app reply in-thread to every row.
    const message = formatSlackMessage(digest(), NOW);
    expect(message).toContain('<https://linear.app/horustech/issue/HOR-80|HOR-80>');
    expect(message).not.toMatch(/(^|[^|/])HOR-80(?![|>])/);
  });

  it('contains no emoji', () => {
    expect(formatSlackMessage(digest(), NOW)).not.toMatch(
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]|:[a-z_]+:/u,
    );
  });
});

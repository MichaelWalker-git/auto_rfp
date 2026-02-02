import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, TextRun, UnderlineType, } from 'docx';
import { saveAs } from 'file-saver';
import type { ExecutiveBriefItem, RiskFlag } from '@auto-rfp/shared';
import type { SectionKey, SectionStatus } from './types';

const FONT_SIZE = {
  title: 34, // ~17pt
  h1: 28, // ~14pt
  h2: 24, // ~12pt
  h3: 22, // ~11pt
  body: 22, // ~11pt
  meta: 20, // ~10pt
  small: 18, // ~9pt
};

const SPACING = {
  tight: { before: 80, after: 80 },
  normal: { before: 120, after: 120 },
  loose: { before: 180, after: 180 },
};

type AlignmentValue = (typeof AlignmentType)[keyof typeof AlignmentType];
type HeadingLevelValue = (typeof HeadingLevel)[keyof typeof HeadingLevel];

function safeText(v: unknown, fallback = '—'): string {
  if (v === null || v === undefined) return fallback;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s.length ? s : fallback;
}

function joinNonEmpty(values: Array<string | null | undefined>, sep = ' • '): string {
  const out = values.map((v) => (v ?? '').trim()).filter(Boolean);
  return out.length ? out.join(sep) : '—';
}

function clamp(s: string, maxChars: number) {
  const t = (s ?? '').trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars - 1).trimEnd()}…`;
}

function pText(
  text: string,
  opts?: {
    bold?: boolean;
    italics?: boolean;
    color?: string;
    size?: number;
    spacing?: { before: number; after: number };
    alignment?: AlignmentValue;
  },
) {
  return new Paragraph({
    alignment: opts?.alignment,
    spacing: opts?.spacing ?? SPACING.normal,
    children: [
      new TextRun({
        text,
        bold: opts?.bold,
        italics: opts?.italics,
        color: opts?.color,
        size: opts?.size ?? FONT_SIZE.body,
      }),
    ],
  });
}

function blank() {
  return new Paragraph({ spacing: { before: 0, after: 0 } });
}

function h(text: string, level: HeadingLevelValue) {
  const size =
    level === HeadingLevel.HEADING_1
      ? FONT_SIZE.h1
      : level === HeadingLevel.HEADING_2
        ? FONT_SIZE.h2
        : FONT_SIZE.h3;

  return new Paragraph({
    heading: level,
    spacing: SPACING.loose,
    children: [new TextRun({ text, bold: true, size })],
  });
}

function divider() {
  // Underlined empty paragraph (simple section divider)
  return new Paragraph({
    spacing: SPACING.loose,
    children: [
      new TextRun({
        text: ' ',
        underline: { type: UnderlineType.SINGLE },
      }),
    ],
  });
}

function metaLine(label: string, value: string) {
  return new Paragraph({
    spacing: SPACING.tight,
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: FONT_SIZE.meta }),
      new TextRun({ text: value, size: FONT_SIZE.meta }),
    ],
  });
}

function bullet(text: string, level = 0, opts?: { size?: number; color?: string }) {
  return new Paragraph({
    bullet: { level },
    spacing: SPACING.tight,
    children: [
      new TextRun({
        text,
        size: opts?.size ?? FONT_SIZE.body,
        color: opts?.color,
      }),
    ],
  });
}

function bullets(items: Array<string | null | undefined>, level = 0) {
  const cleaned = items.map((x) => (x ?? '').trim()).filter(Boolean);
  if (!cleaned.length) return [pText('—', { color: '666666', size: FONT_SIZE.body })];
  return cleaned.map((t) => bullet(t, level));
}

function fmtUsd(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `$${Math.round(n).toLocaleString('en-US')}`;
  }
}

function fmtIso(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return safeText(iso);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function sectionStatus(wrap?: { status?: string | null; updatedAt?: string | null; error?: string | null }) {
  const status = safeText(wrap?.status, '—');
  const updated = wrap?.updatedAt ? fmtIso(wrap.updatedAt) : '—';
  const line = `Status: ${status} • Updated: ${updated}`;
  const out: Paragraph[] = [
    pText(line, { color: '666666', size: FONT_SIZE.meta, spacing: SPACING.tight }),
  ];
  if (wrap?.error) {
    out.push(pText(`Error: ${clamp(safeText(wrap.error), 500)}`, { color: 'AA0000', size: FONT_SIZE.meta }));
  }
  return out;
}

// ---------------------------
// Uniform content blocks
// ---------------------------
function kvList(items: Array<{ label: string; value: string }>): Paragraph[] {
  return items.map((it) => metaLine(it.label, it.value));
}

function longTextBlock(title: string, text: string | null | undefined, opts?: { maxChars?: number }) {
  const maxChars = opts?.maxChars ?? 2200;
  const t = safeText(text, '—');
  return [h(title, HeadingLevel.HEADING_2), pText(clamp(t, maxChars), { spacing: SPACING.normal })];
}

// ---------------------------
// Section builders (balanced)
// ---------------------------
function buildSummary(brief: ExecutiveBriefItem): Paragraph[] {
  const wrap = brief.sections.summary;
  const data = wrap?.data;

  const out: Paragraph[] = [h('Summary', HeadingLevel.HEADING_1), ...sectionStatus(wrap), blank()];

  if (!data) return out.concat(pText('No summary data available.', { color: '666666' }));

  out.push(
    pText(safeText(data.title, 'Opportunity'), { bold: true, size: FONT_SIZE.h2, spacing: SPACING.normal }),
    ...kvList([
      { label: 'Agency', value: safeText(data.agency) },
      { label: 'Office', value: safeText(data.office) },
      { label: 'Solicitation #', value: safeText(data.solicitationNumber) },
      { label: 'NAICS', value: safeText(data.naics) },
      { label: 'Contract Type', value: safeText(data.contractType) },
      { label: 'Set-Aside', value: safeText(data.setAside) },
      { label: 'Place of Performance', value: safeText(data.placeOfPerformance) },
      { label: 'Estimated Value', value: fmtUsd(data.estimatedValueUsd ?? null) },
      { label: 'Period of Performance', value: safeText(data.periodOfPerformance) },
    ]),
    blank(),
    ...longTextBlock('Summary Narrative', data.summary, { maxChars: 1800 }),
    blank(),
  );

  return out;
}

function buildDeadlines(brief: ExecutiveBriefItem): Paragraph[] {
  const wrap = brief.sections.deadlines;
  const data = wrap?.data;

  const out: Paragraph[] = [divider(), h('Deadlines', HeadingLevel.HEADING_1), ...sectionStatus(wrap), blank()];
  if (!data) return out.concat(pText('No deadlines data available.', { color: '666666' }));

  if (data.hasSubmissionDeadline) {
    out.push(metaLine('Submission Deadline', fmtIso(data.submissionDeadlineIso)));
    out.push(blank());
  }

  out.push(h('Key Dates', HeadingLevel.HEADING_2));

  const items = (data.deadlines ?? []).map((d) => {
    const when = fmtIso(d.dateTimeIso ?? null);
    const label = joinNonEmpty([d.label ?? null, d.type ?? null], ' — ');
    const tz = d.timezone ? ` (${d.timezone})` : '';
    const notes = d.notes ? ` | ${clamp(d.notes, 180)}` : '';
    return `${when} — ${safeText(label)}${tz}${notes}`;
  });

  out.push(...bullets(items, 0));

  const warnings = data.warnings ?? [];
  if (warnings.length) {
    out.push(blank(), h('Warnings', HeadingLevel.HEADING_2), ...bullets(warnings, 0));
  }

  return out;
}

function buildRequirements(brief: ExecutiveBriefItem): Paragraph[] {
  const wrap = brief.sections.requirements;
  const data = wrap?.data;

  const out: Paragraph[] = [
    divider(),
    h('Requirements', HeadingLevel.HEADING_1),
    ...sectionStatus(wrap),
    blank(),
  ];
  if (!data) return out.concat(pText('No requirements data available.', { color: '666666' }));

  out.push(...longTextBlock('Overview', data.overview, { maxChars: 1400 }), blank());

  out.push(h('Top Requirements', HeadingLevel.HEADING_2));

  // Keep consistent: show first N requirements, with short evidence
  const reqs = (data.requirements ?? []).slice(0, 12);
  if (!reqs.length) out.push(pText('—', { color: '666666' }));

  reqs.forEach((r, idx) => {
    const must = r.mustHave ? 'MUST-HAVE' : 'NICE-TO-HAVE';
    const cat = r.category ? ` • ${r.category}` : '';
    out.push(bullet(`${idx + 1}. [${must}]${cat} — ${clamp(r.requirement, 260)}`, 0));

    const ev = r.evidence ?? [];
  });

  if ((data.requirements ?? []).length > reqs.length) {
    out.push(pText(`(Showing ${reqs.length} of ${(data.requirements ?? []).length} requirements)`, { color: '666666' }));
  }

  out.push(blank(), h('Deliverables', HeadingLevel.HEADING_2), ...bullets((data.deliverables ?? []).slice(0, 12), 0));
  out.push(
    blank(),
    h('Evaluation Factors', HeadingLevel.HEADING_2),
    ...bullets((data.evaluationFactors ?? []).slice(0, 12), 0),
  );

  const sc = data.submissionCompliance;
  out.push(blank(), h('Submission Compliance', HeadingLevel.HEADING_2));
  out.push(h('Format', HeadingLevel.HEADING_3), ...bullets((sc?.format ?? []).slice(0, 12), 0));
  out.push(h('Required Volumes', HeadingLevel.HEADING_3), ...bullets((sc?.requiredVolumes ?? []).slice(0, 12), 0));
  out.push(h('Attachments / Forms', HeadingLevel.HEADING_3), ...bullets((sc?.attachmentsAndForms ?? []).slice(0, 12), 0));

  return out;
}

function buildContacts(brief: ExecutiveBriefItem): Paragraph[] {
  const wrap = brief.sections.contacts;
  const data = wrap?.data;

  const out: Paragraph[] = [divider(), h('Contacts', HeadingLevel.HEADING_1), ...sectionStatus(wrap), blank()];
  if (!data) return out.concat(pText('No contacts data available.', { color: '666666' }));

  const contacts = (data.contacts ?? []).slice(0, 12);

  out.push(h('Contact List', HeadingLevel.HEADING_2));

  if (!contacts.length) {
    out.push(pText('No contacts extracted.', { color: '666666' }));
  } else {
    contacts.forEach((c) => {
      const header = joinNonEmpty(
        [c.role ? String(c.role) : null, c.name ?? null, c.title ?? null, c.organization ?? null],
        ' • ',
      );

      out.push(bullet(header, 0));

      const details = joinNonEmpty(
        [c.email ? `Email: ${c.email}` : null, c.phone ? `Phone: ${c.phone}` : null],
        ' | ',
      );
      if (details !== '—') out.push(bullet(details, 1));

      if (c.notes) out.push(bullet(`Notes: ${clamp(c.notes, 220)}`, 1));
    });
  }

  const missing = data.missingRecommendedRoles ?? [];
  if (missing.length) {
    out.push(blank(), h('Missing Recommended Roles', HeadingLevel.HEADING_2), ...bullets(missing.map(String), 0));
  }

  return out;
}

function buildRisks(brief: ExecutiveBriefItem): Paragraph[] {
  const wrap = brief.sections.risks;
  const data = wrap?.data;

  const out: Paragraph[] = [divider(), h('Risks', HeadingLevel.HEADING_1), ...sectionStatus(wrap), blank()];
  if (!data) return out.concat(pText('No risks data available.', { color: '666666' }));

  const renderFlags = (title: string, flags: RiskFlag[]) => {
    out.push(h(title, HeadingLevel.HEADING_2));
    if (!flags?.length) {
      out.push(pText('—', { color: '666666' }));
      return;
    }

    // Consistent length: show up to N
    const slice = flags.slice(0, 10);
    slice.forEach((r: RiskFlag, idx: number) => {
      out.push(bullet(`${idx + 1}. [${safeText(r.severity)}] ${clamp(safeText(r.flag), 220)}`, 0));
      if (r.whyItMatters) out.push(bullet(`Why it matters: ${clamp(r.whyItMatters, 260)}`, 1));
      if (r.mitigation) out.push(bullet(`Mitigation: ${clamp(r.mitigation, 260)}`, 1));
      if (r.impactsScore) out.push(bullet(`Impacts score: Yes`, 1));
    });

    if (flags.length > slice.length) {
      out.push(pText(`(Showing ${slice.length} of ${flags.length})`, { color: '666666' }));
    }
  };

  renderFlags('Red Flags', data.redFlags ?? []);
  out.push(blank());
  renderFlags('Risks', data.risks ?? []);

  const inc = data.incumbentInfo;
  out.push(blank(), h('Incumbent Information', HeadingLevel.HEADING_2));
  out.push(
    ...kvList([
      { label: 'Known Incumbent', value: inc?.knownIncumbent ? 'Yes' : 'No' },
      { label: 'Incumbent Name', value: safeText(inc?.incumbentName) },
      { label: 'Recompete', value: inc?.recompete ? 'Yes' : 'No' },
      { label: 'Notes', value: safeText(inc?.notes) },
    ]),
  );
  return out;
}

function buildScoring(brief: ExecutiveBriefItem): Paragraph[] {
  const wrap = brief.sections.scoring;
  const data = wrap?.data;

  const out: Paragraph[] = [divider(), h('Bid Scoring', HeadingLevel.HEADING_1), ...sectionStatus(wrap), blank()];
  if (!data) return out.concat(pText('No scoring data available.', { color: '666666' }));

  out.push(
    ...kvList([
      { label: 'Composite Score', value: safeText(data.compositeScore) },
      { label: 'Recommendation', value: safeText(data.recommendation) },
      { label: 'Confidence', value: `${safeText(data.confidence)}%` },
      ...(data.decision ? [{ label: 'Decision', value: safeText(data.decision) }] : []),
    ]),
  );

  out.push(blank(), ...longTextBlock('Summary Justification', data.summaryJustification, { maxChars: 1400 }));

  if (data.decisionRationale) out.push(blank(), ...longTextBlock('Decision Rationale', data.decisionRationale, { maxChars: 1200 }));

  if ((data.blockers ?? []).length) out.push(blank(), h('Blockers', HeadingLevel.HEADING_2), ...bullets((data.blockers ?? []).slice(0, 12), 0));
  if ((data.requiredActions ?? []).length)
    out.push(blank(), h('Required Actions', HeadingLevel.HEADING_2), ...bullets((data.requiredActions ?? []).slice(0, 12), 0));

  if (data.confidenceExplanation) out.push(blank(), ...longTextBlock('Confidence Explanation', data.confidenceExplanation, { maxChars: 1200 }));

  if ((data.confidenceDrivers ?? []).length) {
    out.push(blank(), h('Confidence Drivers', HeadingLevel.HEADING_2));
    (data.confidenceDrivers ?? []).slice(0, 10).forEach((d) => {
      out.push(bullet(`${safeText(d.factor)} (${d.direction === 'UP' ? '↑' : '↓'})`, 0));
    });
  }

  out.push(blank(), h('Criteria', HeadingLevel.HEADING_2));
  (data.criteria ?? []).forEach((c) => {
    out.push(bullet(`${c.name}: ${c.score}/5`, 0));
    out.push(bullet(`Rationale: ${clamp(safeText(c.rationale), 320)}`, 1));
    if ((c.gaps ?? []).length) {
      out.push(bullet('Gaps:', 1));
      (c.gaps ?? []).slice(0, 8).forEach((g) => out.push(bullet(clamp(g, 220), 2)));
    }
  });

  return out;
}

function fileNameSafe(s: string) {
  return s
    .trim()
    .replace(/[^\w\- ]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/ /g, '_')
    .slice(0, 80);
}

// ---------------------------
// Main export
// ---------------------------
export async function exportBriefAsDocx(projectName: string, briefItem: ExecutiveBriefItem): Promise<void> {
  const title = `Executive Opportunity Brief — ${safeText(projectName, 'Project')}`;

  const headerBadges = joinNonEmpty(
    [
      briefItem.recommendation ? `Recommendation: ${briefItem.recommendation}` : null,
      briefItem.decision ? `Decision: ${briefItem.decision}` : null,
      typeof briefItem.confidence === 'number' ? `Confidence: ${briefItem.confidence}%` : null,
      typeof briefItem.compositeScore === 'number' ? `Score: ${briefItem.compositeScore}/5` : null,
    ],
    ' • ',
  );

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          // Title page-ish header (still single section, no tables)
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: SPACING.loose,
            children: [
              new TextRun({ text: title, bold: true, size: FONT_SIZE.title }),
            ],
          }),
          pText(headerBadges !== '—' ? headerBadges : '—', {
            color: '666666',
            size: FONT_SIZE.meta,
            spacing: SPACING.normal,
          }),

          blank(),
          ...kvList([
            { label: 'Project ID', value: safeText(briefItem.projectId) },
            { label: 'Question File ID', value: safeText(briefItem.questionFileId) },
            { label: 'Brief Status', value: safeText(briefItem.status) },
            { label: 'Created', value: fmtIso(briefItem.createdAt) },
            { label: 'Updated', value: fmtIso(briefItem.updatedAt) },
          ]),

          // Content sections
          ...buildSummary(briefItem),
          ...buildDeadlines(briefItem),
          ...buildRequirements(briefItem),
          ...buildContacts(briefItem),
          ...buildRisks(briefItem),
          ...buildScoring(briefItem),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const name = fileNameSafe(projectName || 'project');
  saveAs(blob, `${name}_Executive_Opportunity_Brief.docx`);
}

export function formatDateTime(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

export function recommendationVariant(rec?: string) {
  if (rec === 'GO') return 'default';
  if (rec === 'NO_GO') return 'destructive';
  if (rec === 'CONDITIONAL_GO') return 'secondary';
  return 'secondary';
}

export function statusBadgeVariant(s: SectionStatus) {
  if (s === 'COMPLETE') return 'default';
  if (s === 'FAILED') return 'destructive';
  if (s === 'IN_PROGRESS') return 'secondary';
  return 'outline';
}

export function statusLabel(s: SectionStatus) {
  if (!s) return '—';
  return s;
}

export function isSectionComplete(brief: ExecutiveBriefItem | null | undefined, section: Exclude<SectionKey, 'scoring'>): boolean {
  return brief?.sections?.[section]?.status === 'COMPLETE';
}

export function scoringPrereqsComplete(brief: ExecutiveBriefItem | null | undefined): { ok: true } | { ok: false; missing: string[] } {
  const prereqs: Exclude<SectionKey, 'scoring'>[] = ['summary', 'deadlines', 'requirements', 'contacts', 'risks'];
  const missing = prereqs.filter((s) => !isSectionComplete(brief, s));
  return missing.length ? { ok: false, missing } : { ok: true };
}

export function buildSectionsState(briefItem: ExecutiveBriefItem | null | undefined) {
  const s = briefItem?.sections;
  if (!s) return null;
  return {
    summary: s.summary?.status,
    deadlines: s.deadlines?.status,
    contacts: s.contacts?.status,
    requirements: s.requirements?.status,
    risks: s.risks?.status,
    scoring: s.scoring?.status,
  } as const;
}

export function calcProgress(sectionsState: Record<string, SectionStatus> | null, totalSections: number) {
  if (!sectionsState) return { completed: 0, percent: 0, inProgress: [] as string[] };

  const completed = Object.values(sectionsState).filter((x) => x === 'COMPLETE').length;
  const percent = (completed / totalSections) * 100;

  const inProgress = Object.entries(sectionsState)
    .filter(([, v]) => v === 'IN_PROGRESS')
    .map(([k]) => k);

  return { completed, percent, inProgress };
}

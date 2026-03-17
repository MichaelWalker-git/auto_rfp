import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
} from 'docx';
import { saveAs } from 'file-saver';
import type { ExecutiveBriefItem, RiskFlag } from '@auto-rfp/core';
import type { SectionKey, SectionStatus } from './types';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';

// ─── Design tokens (matching app's indigo palette) ────────────────────────────

const COLORS = {
  primary: '4338CA',   // indigo-700
  accent: '6366F1',    // indigo-500
  dark: '111827',      // gray-900
  body: '374151',      // gray-700
  muted: '6B7280',     // gray-500
  light: '9CA3AF',     // gray-400
  border: 'E5E7EB',    // gray-200
  headerBg: 'EEF2FF',  // indigo-50
  white: 'FFFFFF',
  success: '059669',   // emerald-600
  warning: 'D97706',   // amber-600
  danger: 'DC2626',    // red-600
  tableHead: '4338CA', // indigo-700
  tableAlt: 'F9FAFB',  // gray-50
};

const FONTS = {
  heading: 'Calibri',
  body: 'Calibri',
};

// EMU conversions
const TWIP = (pt: number) => pt * 20;

const FONT_SIZE = {
  title: TWIP(24),
  subtitle: TWIP(14),
  h1: TWIP(18),
  h2: TWIP(14),
  h3: TWIP(12),
  body: TWIP(11),
  meta: TWIP(10),
  small: TWIP(9),
  badge: TWIP(11),
};

const SPACING = {
  none: { before: 0, after: 0 },
  tight: { before: 40, after: 40 },
  normal: { before: 80, after: 80 },
  section: { before: 120, after: 60 },
  loose: { before: 160, after: 80 },
  pageBreak: { before: 0, after: 0 },
};

// ─── Utility helpers ──────────────────────────────────────────────────────────

const safeText = (v: unknown, fallback = '—'): string => {
  if (v === null || v === undefined) return fallback;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s.length ? s : fallback;
};

const joinNonEmpty = (values: Array<string | null | undefined>, sep = ' • '): string => {
  const out = values.map((v) => (v ?? '').trim()).filter(Boolean);
  return out.length ? out.join(sep) : '—';
};

const clamp = (s: string, maxChars: number) => {
  const t = (s ?? '').trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars - 1).trimEnd()}…`;
};

const fmtUsd = (v: string | null | undefined) => {
  if (!v) return '—';
  return String(v).trim();
};

const fmtIso = (iso: string | null | undefined) => {
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
};

const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return safeText(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

const severityColor = (severity: string): string => {
  switch (severity) {
    case 'CRITICAL': return COLORS.danger;
    case 'HIGH': return COLORS.danger;
    case 'MEDIUM': return COLORS.warning;
    case 'LOW': return COLORS.success;
    default: return COLORS.body;
  }
};

const scoreColor = (score: number | undefined): string => {
  if (!score) return COLORS.muted;
  if (score >= 4) return COLORS.success;
  if (score >= 3) return COLORS.warning;
  return COLORS.danger;
};

const recommendationColor = (rec: string | undefined | null): string => {
  if (rec === 'GO') return COLORS.success;
  if (rec === 'NO_GO') return COLORS.danger;
  return COLORS.warning;
};

// ─── Document element builders ────────────────────────────────────────────────

const blank = () => new Paragraph({ spacing: SPACING.none });

const pageBreak = () => new Paragraph({ children: [new PageBreak()] });

const heading = (text: string, level: 1 | 2 | 3): Paragraph => {
  const configs = {
    1: { size: FONT_SIZE.h1, color: COLORS.primary, bold: true, spacing: SPACING.loose, border: undefined },
    2: { size: FONT_SIZE.h2, color: COLORS.primary, bold: true, spacing: SPACING.section, border: undefined },
    3: { size: FONT_SIZE.h3, color: COLORS.dark, bold: true, spacing: SPACING.normal, border: undefined },
  };
  const cfg = configs[level];

  return new Paragraph({
    spacing: cfg.spacing,
    ...(cfg.border ? { border: cfg.border } : {}),
    children: [new TextRun({ text, bold: cfg.bold, size: cfg.size, color: cfg.color, font: FONTS.heading })],
  });
};

const bodyText = (text: string, opts?: { bold?: boolean; italics?: boolean; color?: string; size?: number }): Paragraph =>
  new Paragraph({
    spacing: SPACING.normal,
    children: [new TextRun({
      text,
      bold: opts?.bold,
      italics: opts?.italics,
      color: opts?.color ?? COLORS.body,
      size: opts?.size ?? FONT_SIZE.body,
      font: FONTS.body,
    })],
  });

const metaLine = (label: string, value: string): Paragraph =>
  new Paragraph({
    spacing: SPACING.tight,
    children: [
      new TextRun({ text: `${label}: `, bold: true, size: FONT_SIZE.meta, color: COLORS.muted, font: FONTS.body }),
      new TextRun({ text: value, size: FONT_SIZE.meta, color: COLORS.dark, font: FONTS.body }),
    ],
  });

const bulletItem = (text: string, level = 0, opts?: { color?: string; bold?: boolean }): Paragraph =>
  new Paragraph({
    bullet: { level },
    spacing: SPACING.tight,
    children: [new TextRun({
      text,
      size: FONT_SIZE.body,
      color: opts?.color ?? COLORS.body,
      bold: opts?.bold,
      font: FONTS.body,
    })],
  });

const bulletList = (items: Array<string | null | undefined>, level = 0): (Paragraph | Table)[] => {
  const cleaned = items.map((x) => (x ?? '').trim()).filter(Boolean);
  if (!cleaned.length) return [bodyText('None identified.', { color: COLORS.muted, italics: true })];
  return cleaned.map((t) => bulletItem(t, level));
};

const divider = (): Paragraph =>
  new Paragraph({
    spacing: SPACING.section,
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: COLORS.border, space: 4 } },
  });

const infoTable = (rows: Array<{ label: string; value: string }>): Table =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map((row) =>
      new TableRow({
        children: [
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.TOP,
            borders: {
              top: { style: BorderStyle.NONE, size: 0 },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border },
              left: { style: BorderStyle.NONE, size: 0 },
              right: { style: BorderStyle.NONE, size: 0 },
            },
            children: [new Paragraph({
              spacing: SPACING.tight,
              children: [new TextRun({ text: row.label, bold: true, size: FONT_SIZE.meta, color: COLORS.muted, font: FONTS.body })],
            })],
          }),
          new TableCell({
            width: { size: 70, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.TOP,
            borders: {
              top: { style: BorderStyle.NONE, size: 0 },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border },
              left: { style: BorderStyle.NONE, size: 0 },
              right: { style: BorderStyle.NONE, size: 0 },
            },
            children: [new Paragraph({
              spacing: SPACING.tight,
              children: [new TextRun({ text: row.value, size: FONT_SIZE.body, color: COLORS.dark, font: FONTS.body })],
            })],
          }),
        ],
      }),
    ),
  });

const sectionStatusLine = (wrap?: { status?: string | null; updatedAt?: string | null; error?: string | null }): (Paragraph | Table)[] => {
  const status = safeText(wrap?.status, '—');
  const updated = wrap?.updatedAt ? fmtIso(wrap.updatedAt) : '—';
  const out: (Paragraph | Table)[] = [
    new Paragraph({
      spacing: SPACING.tight,
      children: [
        new TextRun({ text: `Status: ${status}`, size: FONT_SIZE.small, color: COLORS.light, font: FONTS.body }),
        new TextRun({ text: `  •  Last updated: ${updated}`, size: FONT_SIZE.small, color: COLORS.light, font: FONTS.body }),
      ],
    }),
  ];
  if (wrap?.error) {
    out.push(bodyText(`⚠ Error: ${clamp(safeText(wrap.error), 500)}`, { color: COLORS.danger, size: FONT_SIZE.small }));
  }
  return out;
};

// ─── Cover page ───────────────────────────────────────────────────────────────

const buildCoverPage = (projectName: string, brief: ExecutiveBriefItem): (Paragraph | Table)[] => {
  const paras: (Paragraph | Table)[] = [];

  // Spacer
  paras.push(new Paragraph({ spacing: { before: TWIP(120), after: 0 } }));

  // Title
  paras.push(new Paragraph({
    children: [new TextRun({
      text: 'Executive Opportunity Brief',
      bold: true,
      size: TWIP(32),
      color: COLORS.primary,
      font: FONTS.heading,
    })],
    spacing: { before: TWIP(48), after: TWIP(8) },
    border: { bottom: { style: BorderStyle.THICK, size: 6, color: COLORS.accent, space: 6 } },
  }));

  // Project name
  paras.push(new Paragraph({
    children: [new TextRun({
      text: safeText(projectName, 'Project'),
      size: TWIP(18),
      color: COLORS.dark,
      font: FONTS.heading,
    })],
    spacing: { before: TWIP(16), after: TWIP(24) },
  }));

  // Key metrics badges
  const summaryData = brief.sections.summary?.data;
  const metaItems: Array<{ label: string; value: string }> = [];

  if (summaryData?.agency) metaItems.push({ label: 'Agency', value: safeText(summaryData.agency) });
  if (summaryData?.solicitationNumber) metaItems.push({ label: 'Solicitation #', value: safeText(summaryData.solicitationNumber) });
  if (brief.recommendation) metaItems.push({ label: 'Recommendation', value: brief.recommendation });
  if (brief.decision) metaItems.push({ label: 'Decision', value: brief.decision });
  if (typeof brief.compositeScore === 'number') metaItems.push({ label: 'Composite Score', value: `${brief.compositeScore}/5` });
  if (typeof brief.confidence === 'number') metaItems.push({ label: 'Confidence', value: `${brief.confidence}%` });
  metaItems.push({ label: 'Generated', value: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) });

  if (metaItems.length) {
    paras.push(infoTable(metaItems));
  }

  paras.push(new Paragraph({ spacing: { before: TWIP(36), after: 0 } }));
  paras.push(new Paragraph({
    children: [new TextRun({ text: 'CONFIDENTIAL — FOR INTERNAL USE ONLY', bold: true, size: FONT_SIZE.small, color: COLORS.light, font: FONTS.body })],
  }));

  // Page break
  paras.push(pageBreak());

  return paras;
};

// ─── Section builders ─────────────────────────────────────────────────────────

const buildSummary = (brief: ExecutiveBriefItem): (Paragraph | Table)[] => {
  const wrap = brief.sections.summary;
  const data = wrap?.data;
  const out: (Paragraph | Table)[] = [heading('1. Opportunity Summary', 1), ...sectionStatusLine(wrap), blank()];

  if (!data) return out.concat(bodyText('No summary data available.', { color: COLORS.muted, italics: true }));

  // Opportunity details table
  out.push(infoTable([
    { label: 'Title', value: safeText(data.title, 'Opportunity') },
    { label: 'Agency', value: safeText(data.agency) },
    { label: 'Office', value: safeText(data.office) },
    { label: 'Solicitation #', value: safeText(data.solicitationNumber) },
    { label: 'NAICS Code', value: safeText(data.naics) },
    { label: 'Contract Type', value: safeText(data.contractType) },
    { label: 'Set-Aside', value: safeText(data.setAside) },
    { label: 'Place of Performance', value: safeText(data.placeOfPerformance) },
    { label: 'Estimated Value', value: fmtUsd(data.estimatedValueUsd ?? null) },
    { label: 'Period of Performance', value: safeText(data.periodOfPerformance) },
  ]));

  out.push(blank(), heading('Narrative Summary', 2));
  // Split summary into paragraphs for readability
  const summaryParagraphs = (data.summary ?? '').split(/\n{2,}/);
  for (const para of summaryParagraphs) {
    if (para.trim()) out.push(bodyText(clamp(para.trim(), 2000)));
  }

  return out;
};

const buildDeadlines = (brief: ExecutiveBriefItem): (Paragraph | Table)[] => {
  const wrap = brief.sections.deadlines;
  const data = wrap?.data;
  const out: (Paragraph | Table)[] = [divider(), heading('2. Key Deadlines', 1), ...sectionStatusLine(wrap), blank()];

  if (!data) return out.concat(bodyText('No deadlines data available.', { color: COLORS.muted, italics: true }));

  if (data.hasSubmissionDeadline && data.submissionDeadlineIso) {
    out.push(new Paragraph({
      spacing: SPACING.normal,
      shading: { type: ShadingType.SOLID, color: COLORS.headerBg, fill: COLORS.headerBg },
      children: [
        new TextRun({ text: '📅 Submission Deadline: ', bold: true, size: FONT_SIZE.body, color: COLORS.primary, font: FONTS.body }),
        new TextRun({ text: fmtIso(data.submissionDeadlineIso), bold: true, size: FONT_SIZE.body, color: COLORS.dark, font: FONTS.body }),
      ],
    }));
    out.push(blank());
  }

  // Deadlines as a structured table
  if ((data.deadlines ?? []).length) {
    const deadlineRows = (data.deadlines ?? []).map((d) => [
      safeText(d.label ?? d.type),
      fmtIso(d.dateTimeIso ?? null),
      d.timezone ?? '—',
      d.notes ? clamp(d.notes, 120) : '—',
    ]);

    out.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: ['Deadline', 'Date/Time', 'Timezone', 'Notes'].map((h) =>
            new TableCell({
              shading: { type: ShadingType.SOLID, color: COLORS.tableHead, fill: COLORS.tableHead },
              borders: { top: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, left: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, right: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border } },
              children: [new Paragraph({ spacing: SPACING.tight, children: [new TextRun({ text: h, bold: true, color: COLORS.white, size: FONT_SIZE.meta, font: FONTS.body })] })],
            }),
          ),
        }),
        ...deadlineRows.map((row, idx) =>
          new TableRow({
            children: row.map((cell) =>
              new TableCell({
                shading: idx % 2 === 0 ? { type: ShadingType.SOLID, color: COLORS.tableAlt, fill: COLORS.tableAlt } : undefined,
                borders: { top: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, left: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, right: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border } },
                children: [new Paragraph({ spacing: SPACING.tight, children: [new TextRun({ text: cell, size: FONT_SIZE.meta, color: COLORS.body, font: FONTS.body })] })],
              }),
            ),
          }),
        ),
      ],
    }));
  }

  const warnings = data.warnings ?? [];
  if (warnings.length) {
    out.push(blank(), heading('⚠ Warnings', 3));
    out.push(...bulletList(warnings));
  }

  return out;
};

const buildRequirements = (brief: ExecutiveBriefItem): (Paragraph | Table)[] => {
  const wrap = brief.sections.requirements;
  const data = wrap?.data;
  const out: (Paragraph | Table)[] = [divider(), heading('3. Requirements Analysis', 1), ...sectionStatusLine(wrap), blank()];

  if (!data) return out.concat(bodyText('No requirements data available.', { color: COLORS.muted, italics: true }));

  // Overview
  out.push(heading('Overview', 2));
  const overviewParagraphs = (data.overview ?? '').split(/\n{2,}/);
  for (const para of overviewParagraphs) {
    if (para.trim()) out.push(bodyText(clamp(para.trim(), 1500)));
  }

  // Requirements list
  out.push(blank(), heading('Key Requirements', 2));
  const reqs = (data.requirements ?? []).slice(0, 15);
  if (!reqs.length) {
    out.push(bodyText('No requirements extracted.', { color: COLORS.muted, italics: true }));
  } else {
    reqs.forEach((r, idx) => {
      const must = r.mustHave ? '✓ MUST-HAVE' : '○ Nice-to-have';
      const cat = r.category ? ` [${r.category}]` : '';
      out.push(bulletItem(`${idx + 1}. ${must}${cat} — ${clamp(r.requirement, 300)}`, 0, {
        color: r.mustHave ? COLORS.dark : COLORS.muted,
        bold: r.mustHave,
      }));
    });
    if ((data.requirements ?? []).length > reqs.length) {
      out.push(bodyText(`(${reqs.length} of ${(data.requirements ?? []).length} requirements shown)`, { color: COLORS.light, size: FONT_SIZE.small }));
    }
  }

  // Evaluation factors
  if ((data.evaluationFactors ?? []).length) {
    out.push(blank(), heading('Evaluation Factors', 2));
    out.push(...bulletList(data.evaluationFactors?.slice(0, 12)));
  }

  // Deliverables
  if ((data.deliverables ?? []).length) {
    out.push(blank(), heading('Deliverables', 2));
    out.push(...bulletList(data.deliverables?.slice(0, 12)));
  }

  // Submission compliance
  const sc = data.submissionCompliance;
  if (sc) {
    out.push(blank(), heading('Submission Compliance', 2));
    if ((sc.format ?? []).length) {
      out.push(heading('Format Requirements', 3), ...bulletList(sc.format?.slice(0, 10)));
    }
    if ((sc.requiredVolumes ?? []).length) {
      out.push(heading('Required Volumes', 3), ...bulletList(sc.requiredVolumes?.slice(0, 10)));
    }
    if ((sc.attachmentsAndForms ?? []).length) {
      out.push(heading('Attachments & Forms', 3), ...bulletList(sc.attachmentsAndForms?.slice(0, 10)));
    }
  }

  return out;
};

const buildContacts = (brief: ExecutiveBriefItem): (Paragraph | Table)[] => {
  const wrap = brief.sections.contacts;
  const data = wrap?.data;
  const out: (Paragraph | Table)[] = [divider(), heading('4. Key Contacts', 1), ...sectionStatusLine(wrap), blank()];

  if (!data) return out.concat(bodyText('No contacts data available.', { color: COLORS.muted, italics: true }));

  const contacts = (data.contacts ?? []).slice(0, 15);
  if (!contacts.length) {
    out.push(bodyText('No contacts extracted.', { color: COLORS.muted, italics: true }));
  } else {
    // Contacts as a table for better readability
    out.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: ['Role', 'Name / Title', 'Contact Info', 'Organization'].map((h) =>
            new TableCell({
              shading: { type: ShadingType.SOLID, color: COLORS.tableHead, fill: COLORS.tableHead },
              borders: { top: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, left: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, right: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border } },
              children: [new Paragraph({ spacing: SPACING.tight, children: [new TextRun({ text: h, bold: true, color: COLORS.white, size: FONT_SIZE.meta, font: FONTS.body })] })],
            }),
          ),
        }),
        ...contacts.map((c, idx) =>
          new TableRow({
            children: [
              safeText(c.role),
              joinNonEmpty([c.name ?? null, c.title ?? null], '\n'),
              joinNonEmpty([c.email ?? null, c.phone ?? null], '\n'),
              safeText(c.organization),
            ].map((cell) =>
              new TableCell({
                shading: idx % 2 === 0 ? { type: ShadingType.SOLID, color: COLORS.tableAlt, fill: COLORS.tableAlt } : undefined,
                borders: { top: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, left: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, right: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border } },
                children: [new Paragraph({ spacing: SPACING.tight, children: [new TextRun({ text: cell, size: FONT_SIZE.meta, color: COLORS.body, font: FONTS.body })] })],
              }),
            ),
          }),
        ),
      ],
    }));
  }

  const missing = data.missingRecommendedRoles ?? [];
  if (missing.length) {
    out.push(blank(), heading('Missing Recommended Roles', 3));
    out.push(...bulletList(missing.map(String)));
  }

  return out;
};

const buildRisks = (brief: ExecutiveBriefItem): (Paragraph | Table)[] => {
  const wrap = brief.sections.risks;
  const data = wrap?.data;
  const out: (Paragraph | Table)[] = [divider(), heading('5. Risk Assessment', 1), ...sectionStatusLine(wrap), blank()];

  if (!data) return out.concat(bodyText('No risks data available.', { color: COLORS.muted, italics: true }));

  const renderFlags = (title: string, flags: RiskFlag[]) => {
    out.push(heading(title, 2));
    if (!flags?.length) {
      out.push(bodyText('None identified.', { color: COLORS.muted, italics: true }));
      return;
    }

    const slice = flags.slice(0, 12);
    slice.forEach((r: RiskFlag, idx: number) => {
      out.push(bulletItem(
        `${idx + 1}. [${safeText(r.severity)}] ${clamp(safeText(r.flag), 280)}`,
        0,
        { color: severityColor(safeText(r.severity)), bold: true },
      ));
      if (r.whyItMatters) out.push(bulletItem(`Why it matters: ${clamp(r.whyItMatters, 300)}`, 1));
      if (r.mitigation) out.push(bulletItem(`Mitigation: ${clamp(r.mitigation, 300)}`, 1));
      if (r.impactsScore) out.push(bulletItem('⚠ Impacts bid score', 1, { color: COLORS.warning }));
    });

    if (flags.length > slice.length) {
      out.push(bodyText(`(${slice.length} of ${flags.length} shown)`, { color: COLORS.light, size: FONT_SIZE.small }));
    }
  };

  renderFlags('🚩 Red Flags', data.redFlags ?? []);
  out.push(blank());
  renderFlags('Identified Risks', data.risks ?? []);

  // Incumbent info
  const inc = data.incumbentInfo;
  if (inc) {
    out.push(blank(), heading('Incumbent Information', 2));
    out.push(infoTable([
      { label: 'Known Incumbent', value: inc.knownIncumbent ? '✓ Yes' : '✗ No' },
      { label: 'Incumbent Name', value: safeText(inc.incumbentName) },
      { label: 'Recompete', value: inc.recompete ? '✓ Yes' : '✗ No' },
      { label: 'Notes', value: safeText(inc.notes) },
    ]));
  }

  return out;
};

const buildScoring = (brief: ExecutiveBriefItem): (Paragraph | Table)[] => {
  const wrap = brief.sections.scoring;
  const data = wrap?.data;
  const out: (Paragraph | Table)[] = [divider(), heading('6. Bid Scoring & Recommendation', 1), ...sectionStatusLine(wrap), blank()];

  if (!data) return out.concat(bodyText('No scoring data available.', { color: COLORS.muted, italics: true }));

  // Score summary table
  const scoreItems: Array<{ label: string; value: string }> = [];
  if (data.compositeScore !== undefined) scoreItems.push({ label: 'Composite Score', value: `${data.compositeScore}/5` });
  if (data.recommendation) scoreItems.push({ label: 'Recommendation', value: data.recommendation });
  if (data.confidence !== undefined) scoreItems.push({ label: 'Confidence', value: `${data.confidence}%` });
  if (data.decision) scoreItems.push({ label: 'Decision', value: data.decision });

  if (scoreItems.length) {
    out.push(infoTable(scoreItems));
    out.push(blank());
  }

  // Justification
  if (data.summaryJustification) {
    out.push(heading('Summary Justification', 2));
    const justParagraphs = data.summaryJustification.split(/\n{2,}/);
    for (const para of justParagraphs) {
      if (para.trim()) out.push(bodyText(clamp(para.trim(), 1500)));
    }
  }

  if (data.decisionRationale) {
    out.push(blank(), heading('Decision Rationale', 2));
    const ratParagraphs = data.decisionRationale.split(/\n{2,}/);
    for (const para of ratParagraphs) {
      if (para.trim()) out.push(bodyText(clamp(para.trim(), 1500)));
    }
  }

  // Criteria scores
  if ((data.criteria ?? []).length) {
    out.push(blank(), heading('Scoring Criteria', 2));

    // Criteria as a table
    out.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: ['Criterion', 'Score', 'Rationale', 'Gaps'].map((h) =>
            new TableCell({
              shading: { type: ShadingType.SOLID, color: COLORS.tableHead, fill: COLORS.tableHead },
              borders: { top: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, left: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, right: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border } },
              children: [new Paragraph({ spacing: SPACING.tight, children: [new TextRun({ text: h, bold: true, color: COLORS.white, size: FONT_SIZE.meta, font: FONTS.body })] })],
            }),
          ),
        }),
        ...(data.criteria ?? []).map((c, idx) =>
          new TableRow({
            children: [
              safeText(c.name),
              c.score ? `${c.score}/5` : '—',
              clamp(safeText(c.rationale), 200),
              (c.gaps ?? []).length ? (c.gaps ?? []).slice(0, 3).join('; ') : '—',
            ].map((cell, colIdx) =>
              new TableCell({
                shading: idx % 2 === 0 ? { type: ShadingType.SOLID, color: COLORS.tableAlt, fill: COLORS.tableAlt } : undefined,
                borders: { top: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, left: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border }, right: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border } },
                children: [new Paragraph({
                  spacing: SPACING.tight,
                  children: [new TextRun({
                    text: cell,
                    size: FONT_SIZE.meta,
                    color: colIdx === 1 ? scoreColor(c.score) : COLORS.body,
                    bold: colIdx === 1,
                    font: FONTS.body,
                  })],
                })],
              }),
            ),
          }),
        ),
      ],
    }));
  }

  // Blockers & required actions
  if ((data.blockers ?? []).length) {
    out.push(blank(), heading('🚫 Blockers', 3));
    out.push(...bulletList(data.blockers?.slice(0, 10) ?? []));
  }
  if ((data.requiredActions ?? []).length) {
    out.push(blank(), heading('✅ Required Actions', 3));
    out.push(...bulletList(data.requiredActions?.slice(0, 10) ?? []));
  }

  // Confidence drivers
  if ((data.confidenceDrivers ?? []).length) {
    out.push(blank(), heading('Confidence Drivers', 3));
    (data.confidenceDrivers ?? []).slice(0, 10).forEach((d) => {
      const arrow = d.direction === 'UP' ? '↑' : '↓';
      const color = d.direction === 'UP' ? COLORS.success : COLORS.danger;
      out.push(bulletItem(`${arrow} ${safeText(d.factor)}`, 0, { color }));
    });
  }

  if (data.confidenceExplanation) {
    out.push(blank(), heading('Confidence Explanation', 3));
    out.push(bodyText(clamp(data.confidenceExplanation, 1200)));
  }

  return out;
};

const fileNameSafe = (s: string) =>
  s.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, ' ').replace(/ /g, '_').slice(0, 80);

// ─── Backend API export (preferred) ───────────────────────────────────────────

/**
 * Export executive brief via backend API — generates DOCX server-side,
 * uploads to S3, and returns a presigned download URL.
 * Falls back to client-side generation if the API call fails.
 */
export const exportBriefAsDocx = async (
  projectName: string,
  briefItem: ExecutiveBriefItem,
): Promise<void> => {
  // Try backend API first (better quality, consistent rendering)
  try {
    const url = `${env.BASE_API_URL}/brief/export-brief-docx`;
    const res = await authFetcher(url, {
      method: 'POST',
      body: JSON.stringify({
        projectId: briefItem.projectId,
        opportunityId: briefItem.opportunityId,
        projectName,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success && data.export?.url) {
        // Open the presigned S3 URL to trigger download
        window.open(data.export.url, '_blank');
        return;
      }
    }
    console.warn('Backend brief export failed, falling back to client-side generation');
  } catch (err) {
    console.warn('Backend brief export error, falling back to client-side:', err);
  }

  // Fallback: client-side generation
  await exportBriefAsDocxClientSide(projectName, briefItem);
};

/**
 * Client-side DOCX generation fallback.
 * Used when the backend API is unavailable.
 */
const exportBriefAsDocxClientSide = async (projectName: string, briefItem: ExecutiveBriefItem): Promise<void> => {
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: FONTS.body, size: FONT_SIZE.body, color: COLORS.body },
          paragraph: { spacing: { line: 276 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: TWIP(72),
              bottom: TWIP(72),
              left: TWIP(90),
              right: TWIP(90),
            },
          },
        },
        children: [
          ...buildCoverPage(projectName, briefItem),
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
};

// ─── Shared utility exports ───────────────────────────────────────────────────

export const formatDateTime = (value?: string) => {
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
};

export const formatDate = (value?: string) => {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
};

export const recommendationVariant = (rec?: string) => {
  if (rec === 'GO') return 'default';
  if (rec === 'NO_GO') return 'destructive';
  if (rec === 'CONDITIONAL_GO') return 'secondary';
  return 'secondary';
};

export const statusBadgeVariant = (s: SectionStatus) => {
  if (s === 'COMPLETE') return 'default';
  if (s === 'FAILED') return 'destructive';
  if (s === 'IN_PROGRESS') return 'secondary';
  return 'outline';
};

export const statusLabel = (s: SectionStatus) => {
  if (!s) return '—';
  return s;
};

export const isSectionComplete = (brief: ExecutiveBriefItem | null | undefined, section: Exclude<SectionKey, 'scoring'>): boolean =>
  brief?.sections?.[section]?.status === 'COMPLETE';

export const scoringPrereqsComplete = (brief: ExecutiveBriefItem | null | undefined): { ok: true } | { ok: false; missing: string[] } => {
  const prereqs: Exclude<SectionKey, 'scoring'>[] = ['summary', 'deadlines', 'requirements', 'contacts', 'risks'];
  const missing = prereqs.filter((s) => !isSectionComplete(brief, s));
  return missing.length ? { ok: false, missing } : { ok: true };
};

export const buildSectionsState = (briefItem: ExecutiveBriefItem | null | undefined) => {
  const s = briefItem?.sections;
  if (!s) return null;
  return {
    summary: s.summary?.status,
    deadlines: s.deadlines?.status,
    contacts: s.contacts?.status,
    requirements: s.requirements?.status,
    risks: s.risks?.status,
    pricing: s.pricing?.status,
    pastPerformance: s.pastPerformance?.status,
    scoring: s.scoring?.status,
  } as const;
};

export const calcProgress = (sectionsState: Record<string, SectionStatus> | null, totalSections: number) => {
  if (!sectionsState) return { completed: 0, percent: 0, inProgress: [] as string[] };

  const completed = Object.values(sectionsState).filter((x) => x === 'COMPLETE').length;
  const percent = (completed / totalSections) * 100;

  const inProgress = Object.entries(sectionsState)
    .filter(([, v]) => v === 'IN_PROGRESS')
    .map(([k]) => k);

  return { completed, percent, inProgress };
};

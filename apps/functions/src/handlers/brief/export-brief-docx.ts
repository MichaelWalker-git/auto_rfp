import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  HeadingLevel,
} from 'docx';
import middy from '@middy/core';
import { z } from 'zod';

import type { ExecutiveBriefItem, PastPerformanceSection, RiskFlag } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { requireEnv } from '@/helpers/env';
import { getExecutiveBriefByProjectId } from '@/helpers/executive-opportunity-brief';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const PRESIGN_EXPIRES_IN = 3600;

const s3Client = new S3Client({ region: REGION });

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  primary: '4338CA', accent: '6366F1', dark: '111827', body: '374151',
  muted: '6B7280', light: '9CA3AF', border: 'D1D5DB', softBorder: 'E5E7EB',
  headerBg: 'EEF2FF', white: 'FFFFFF', success: '059669', warning: 'D97706',
  danger: 'DC2626', tableHead: '4338CA', tableAlt: 'F9FAFB',
};

const FONT = 'Calibri';
// docx `size` uses half-points (1pt = 2 half-points). E.g. 11pt = 22.
const HP = (pt: number) => pt * 2;
// docx spacing/margins use twips (1pt = 20 twips). E.g. 72pt = 1440.
const TW = (pt: number) => pt * 20;
// US Letter = 8.5in = 12240 twips. Margins = 90pt each side = 1800tw × 2 = 3600tw.
const CONTENT_WIDTH_TW = 12240 - TW(90) * 2; // 8640 twips

// ─── Request schema ───────────────────────────────────────────────────────────

const ExportBriefRequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  projectName: z.string().optional(),
  opportunityName: z.string().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const safe = (v: unknown, fb = '—'): string => {
  if (v == null) return fb;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s || fb;
};

const join = (vals: Array<string | null | undefined>, sep = ' · '): string => {
  const out = vals.map((v) => (v ?? '').trim()).filter(Boolean);
  return out.length ? out.join(sep) : '—';
};

const clip = (s: string, max: number) => {
  const t = (s ?? '').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

const fmtIso = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return safe(iso);
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
};

const sevColor = (s: string) => (s === 'CRITICAL' || s === 'HIGH') ? C.danger : s === 'MEDIUM' ? C.warning : s === 'LOW' ? C.success : C.body;

// ─── Reusable element builders ────────────────────────────────────────────────

const blank = () => new Paragraph({ spacing: { before: 0, after: 0 } });
const pb = () => new Paragraph({ children: [new PageBreak()] });

const h1 = (text: string) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: TW(18), after: TW(6) },
  border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.accent, space: 4 } },
  children: [new TextRun({ text, bold: true, size: HP(18), color: C.primary, font: FONT })],
});

const h2 = (text: string) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: TW(14), after: TW(4) },
  border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: C.softBorder, space: 3 } },
  children: [new TextRun({ text, bold: true, size: HP(14), color: C.primary, font: FONT })],
});

const h3 = (text: string) => new Paragraph({
  heading: HeadingLevel.HEADING_3,
  spacing: { before: TW(10), after: TW(3) },
  children: [new TextRun({ text, bold: true, size: HP(12), color: C.dark, font: FONT })],
});

const p = (text: string, opts?: { bold?: boolean; italics?: boolean; color?: string; size?: number }): Paragraph =>
  new Paragraph({
    spacing: { before: TW(2), after: TW(4), line: 276 },
    children: [new TextRun({ text, bold: opts?.bold, italics: opts?.italics, color: opts?.color ?? C.body, size: opts?.size ?? HP(11), font: FONT })],
  });

const bullet = (text: string, level = 0, opts?: { color?: string; bold?: boolean }): Paragraph =>
  new Paragraph({
    bullet: { level },
    spacing: { before: TW(1), after: TW(2) },
    children: [new TextRun({ text, size: HP(11), color: opts?.color ?? C.body, bold: opts?.bold, font: FONT })],
  });

const bullets = (items: Array<string | null | undefined>) => {
  const cleaned = items.map((x) => (x ?? '').trim()).filter(Boolean);
  if (!cleaned.length) return [p('None identified.', { color: C.muted, italics: true })];
  return cleaned.map((t) => bullet(t));
};

const cellBorders = {
  top: { style: BorderStyle.SINGLE, size: 1, color: C.softBorder },
  bottom: { style: BorderStyle.SINGLE, size: 1, color: C.softBorder },
  left: { style: BorderStyle.SINGLE, size: 1, color: C.softBorder },
  right: { style: BorderStyle.SINGLE, size: 1, color: C.softBorder },
};

const kvTable = (rows: Array<{ label: string; value: string }>): Table =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: [Math.floor(CONTENT_WIDTH_TW * 0.3), Math.floor(CONTENT_WIDTH_TW * 0.7)],
    rows: rows.map((row, idx) => {
      const isLast = idx === rows.length - 1;
      const bottom = isLast
        ? { style: BorderStyle.NONE, size: 0 }
        : { style: BorderStyle.SINGLE, size: 1, color: C.softBorder };
      return new TableRow({
        children: [
          new TableCell({
            width: { size: 30, type: WidthType.PERCENTAGE }, verticalAlign: VerticalAlign.TOP,
            margins: { top: TW(6), bottom: TW(6), left: TW(8), right: TW(8) },
            borders: { top: { style: BorderStyle.NONE, size: 0 }, bottom, left: { style: BorderStyle.NONE, size: 0 }, right: { style: BorderStyle.NONE, size: 0 } },
            children: [new Paragraph({ spacing: { before: TW(2), after: TW(2) }, children: [new TextRun({ text: row.label, bold: true, size: HP(10), color: C.muted, font: FONT })] })],
          }),
          new TableCell({
            width: { size: 70, type: WidthType.PERCENTAGE }, verticalAlign: VerticalAlign.TOP,
            margins: { top: TW(6), bottom: TW(6), left: TW(8), right: TW(8) },
            borders: { top: { style: BorderStyle.NONE, size: 0 }, bottom, left: { style: BorderStyle.NONE, size: 0 }, right: { style: BorderStyle.NONE, size: 0 } },
            children: [new Paragraph({ spacing: { before: TW(2), after: TW(2) }, children: [new TextRun({ text: row.value, size: HP(11), color: C.dark, font: FONT })] })],
          }),
        ],
      });
    }),
  });

const dataTable = (headers: string[], rows: string[][], colPcts?: number[]): Table =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: colPcts
      ? colPcts.map((pct) => Math.floor(CONTENT_WIDTH_TW * pct / 100))
      : headers.map(() => Math.floor(CONTENT_WIDTH_TW / headers.length)),
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((hdr) =>
          new TableCell({
            shading: { type: ShadingType.SOLID, color: C.tableHead, fill: C.tableHead },
            borders: cellBorders,
            margins: { top: TW(6), bottom: TW(6), left: TW(10), right: TW(10) },
            children: [new Paragraph({ spacing: { before: TW(1), after: TW(1) }, children: [new TextRun({ text: hdr, bold: true, color: C.white, size: HP(10), font: FONT })] })],
          }),
        ),
      }),
      ...rows.map((row, idx) =>
        new TableRow({
          children: row.map((cell) =>
            new TableCell({
              shading: idx % 2 === 0 ? { type: ShadingType.SOLID, color: C.tableAlt, fill: C.tableAlt } : undefined,
              borders: cellBorders,
              margins: { top: TW(6), bottom: TW(6), left: TW(10), right: TW(10) },
              children: [new Paragraph({ spacing: { before: TW(1), after: TW(1) }, children: [new TextRun({ text: cell, size: HP(10), color: C.body, font: FONT })] })],
            }),
          ),
        }),
      ),
    ],
  });

// ─── Section builders ─────────────────────────────────────────────────────────

const buildCover = (projectName: string, brief: ExecutiveBriefItem): (Paragraph | Table)[] => {
  const sd = brief.sections.summary?.data;
  return [
    new Paragraph({ spacing: { before: TW(160), after: 0 } }),
    new Paragraph({
      spacing: { before: TW(40), after: TW(8) },
      border: { bottom: { style: BorderStyle.THICK, size: 8, color: C.accent, space: 8 } },
      children: [new TextRun({ text: 'Executive Opportunity Brief', bold: true, size: HP(36), color: C.primary, font: FONT })],
    }),
    new Paragraph({
      spacing: { before: TW(12), after: TW(32) },
      children: [new TextRun({ text: safe(projectName, 'Project'), size: HP(20), color: C.dark, font: FONT })],
    }),
    kvTable([
      ...(sd?.agency ? [{ label: 'Agency', value: safe(sd.agency) }] : []),
      ...(sd?.solicitationNumber ? [{ label: 'Solicitation #', value: safe(sd.solicitationNumber) }] : []),
      ...(brief.recommendation ? [{ label: 'Recommendation', value: brief.recommendation }] : []),
      ...(brief.decision ? [{ label: 'Decision', value: brief.decision }] : []),
      ...(typeof brief.compositeScore === 'number' ? [{ label: 'Score', value: `${brief.compositeScore}/5` }] : []),
      ...(typeof brief.confidence === 'number' ? [{ label: 'Confidence', value: `${brief.confidence}%` }] : []),
      { label: 'Generated', value: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) },
    ]),
    new Paragraph({ spacing: { before: TW(48), after: 0 } }),
    p('CONFIDENTIAL — FOR INTERNAL USE ONLY', { bold: true, size: HP(9), color: C.light }),
    pb(),
  ];
};

const buildSummary = (brief: ExecutiveBriefItem): (Paragraph | Table)[] => {
  const d = brief.sections.summary?.data;
  const out: (Paragraph | Table)[] = [h1('1. Opportunity Summary')];
  if (!d) return [...out, p('No summary data available.', { color: C.muted, italics: true })];
  out.push(kvTable([
    { label: 'Title', value: safe(d.title) }, { label: 'Agency', value: safe(d.agency) },
    { label: 'Office', value: safe(d.office) }, { label: 'Solicitation #', value: safe(d.solicitationNumber) },
    { label: 'NAICS', value: safe(d.naics) }, { label: 'Contract Type', value: safe(d.contractType) },
    { label: 'Set-Aside', value: safe(d.setAside) }, { label: 'Place of Performance', value: safe(d.placeOfPerformance) },
    { label: 'Estimated Value', value: safe(d.estimatedValueUsd) }, { label: 'Period of Performance', value: safe(d.periodOfPerformance) },
  ]));
  out.push(blank(), h2('Narrative Summary'));
  for (const para of (d.summary ?? '').split(/\n{2,}/)) { if (para.trim()) out.push(p(clip(para.trim(), 2000))); }
  return out;
};

const buildDeadlines = (brief: ExecutiveBriefItem): (Paragraph | Table)[] => {
  const d = brief.sections.deadlines?.data;
  const out: (Paragraph | Table)[] = [h1('2. Key Deadlines')];
  if (!d) return [...out, p('No deadlines data available.', { color: C.muted, italics: true })];
  if (d.hasSubmissionDeadline && d.submissionDeadlineIso) {
    out.push(new Paragraph({
      spacing: { before: TW(4), after: TW(6) },
      shading: { type: ShadingType.SOLID, color: C.headerBg, fill: C.headerBg },
      children: [
        new TextRun({ text: '  Submission Deadline: ', bold: true, size: HP(12), color: C.primary, font: FONT }),
        new TextRun({ text: fmtIso(d.submissionDeadlineIso), bold: true, size: HP(12), color: C.dark, font: FONT }),
      ],
    }));
    out.push(blank());
  }
  if ((d.deadlines ?? []).length) {
    out.push(dataTable(['Deadline', 'Date/Time', 'Timezone', 'Notes'],
      (d.deadlines ?? []).map((dl) => [safe(dl.label ?? dl.type), fmtIso(dl.dateTimeIso ?? null), dl.timezone ?? '—', dl.notes ? clip(dl.notes, 100) : '—'])));
  }
  if ((d.warnings ?? []).length) { out.push(blank(), h3('Warnings'), ...bullets(d.warnings)); }
  return out;
};

const buildRequirements = (brief: ExecutiveBriefItem): (Paragraph | Table)[] => {
  const d = brief.sections.requirements?.data;
  const out: (Paragraph | Table)[] = [h1('3. Requirements Analysis')];
  if (!d) return [...out, p('No requirements data available.', { color: C.muted, italics: true })];
  out.push(h2('Overview'));
  for (const para of (d.overview ?? '').split(/\n{2,}/)) { if (para.trim()) out.push(p(clip(para.trim(), 1500))); }
  out.push(blank(), h2('Key Requirements'));
  const reqs = (d.requirements ?? []).slice(0, 15);
  reqs.forEach((r, i) => {
    const tag = r.mustHave ? '✓ MUST-HAVE' : '○ Nice-to-have';
    const cat = r.category ? ` [${r.category}]` : '';
    out.push(bullet(`${i + 1}. ${tag}${cat} — ${clip(r.requirement, 300)}`, 0, { color: r.mustHave ? C.dark : C.muted, bold: r.mustHave }));
  });
  if ((d.evaluationFactors ?? []).length) { out.push(blank(), h2('Evaluation Factors'), ...bullets(d.evaluationFactors?.slice(0, 12) ?? [])); }
  if ((d.deliverables ?? []).length) { out.push(blank(), h2('Deliverables'), ...bullets(d.deliverables?.slice(0, 12) ?? [])); }
  const sc = d.submissionCompliance;
  if (sc) {
    out.push(blank(), h2('Submission Compliance'));
    if ((sc.format ?? []).length) { out.push(h3('Format'), ...bullets(sc.format?.slice(0, 10) ?? [])); }
    if ((sc.requiredVolumes ?? []).length) { out.push(h3('Required Volumes'), ...bullets(sc.requiredVolumes?.slice(0, 10) ?? [])); }
    if ((sc.attachmentsAndForms ?? []).length) { out.push(h3('Attachments & Forms'), ...bullets(sc.attachmentsAndForms?.slice(0, 10) ?? [])); }
    // Required response documents
    const reqDocs = sc.requiredDocuments ?? [];
    if (reqDocs.length) {
      out.push(h3('Required Response Documents'));
      out.push(dataTable(
        ['Document', 'Type', 'Page Limit', 'Required'],
        reqDocs.slice(0, 15).map((doc) => [
          safe(doc.name),
          safe(doc.documentType),
          safe(doc.pageLimit),
          doc.required ? 'Yes' : 'No',
        ]),
        [35, 25, 20, 20],
      ));
    }
  }
  return out;
};

const buildContacts = (brief: ExecutiveBriefItem): (Paragraph | Table)[] => {
  const d = brief.sections.contacts?.data;
  const out: (Paragraph | Table)[] = [h1('4. Key Contacts')];
  if (!d) return [...out, p('No contacts data available.', { color: C.muted, italics: true })];
  const contacts = (d.contacts ?? []).slice(0, 15);
  if (!contacts.length) return [...out, p('No contacts extracted.', { color: C.muted, italics: true })];
  out.push(dataTable(['Role', 'Name / Title', 'Contact Info', 'Organization'],
    contacts.map((c) => [safe(c.role), join([c.name ?? null, c.title ?? null], ' — '), join([c.email ?? null, c.phone ?? null], ' | '), safe(c.organization)])));
  if ((d.missingRecommendedRoles ?? []).length) { out.push(blank(), h3('Missing Roles'), ...bullets(d.missingRecommendedRoles?.map(String) ?? [])); }
  return out;
};

const buildRisks = (brief: ExecutiveBriefItem): (Paragraph | Table)[] => {
  const d = brief.sections.risks?.data;
  const out: (Paragraph | Table)[] = [h1('5. Risk Assessment')];
  if (!d) return [...out, p('No risks data available.', { color: C.muted, italics: true })];
  const renderFlags = (title: string, flags: RiskFlag[]) => {
    out.push(h2(title));
    if (!flags?.length) { out.push(p('None identified.', { color: C.muted, italics: true })); return; }
    flags.slice(0, 12).forEach((r, i) => {
      out.push(bullet(`${i + 1}. [${safe(r.severity)}] ${clip(safe(r.flag), 280)}`, 0, { color: sevColor(safe(r.severity)), bold: true }));
      if (r.whyItMatters) out.push(bullet(`Why: ${clip(r.whyItMatters, 300)}`, 1));
      if (r.mitigation) out.push(bullet(`Mitigation: ${clip(r.mitigation, 300)}`, 1));
    });
  };
  renderFlags('Red Flags', d.redFlags ?? []);
  out.push(blank());
  renderFlags('Identified Risks', d.risks ?? []);
  const inc = d.incumbentInfo;
  if (inc) {
    out.push(blank(), h2('Incumbent Information'));
    out.push(kvTable([
      { label: 'Known Incumbent', value: inc.knownIncumbent ? 'Yes' : 'No' },
      { label: 'Name', value: safe(inc.incumbentName) },
      { label: 'Recompete', value: inc.recompete ? 'Yes' : 'No' },
      { label: 'Notes', value: safe(inc.notes) },
    ]));
  }
  return out;
};

const buildPastPerformance = (brief: ExecutiveBriefItem): (Paragraph | Table)[] => {
  const d = (brief.sections as Record<string, { data?: PastPerformanceSection | null }>)?.pastPerformance?.data;
  const out: (Paragraph | Table)[] = [h1('6. Past Performance')];
  if (!d) return [...out, p('No past performance analysis available.', { color: C.muted, italics: true })];

  // Narrative summary
  if (d.narrativeSummary) {
    out.push(h2('Summary'));
    for (const para of d.narrativeSummary.split(/\n{2,}/)) {
      if (para.trim()) out.push(p(clip(para.trim(), 1500)));
    }
  }

  // Confidence score
  if (d.confidenceScore != null) {
    out.push(blank(), p(`Past Performance Confidence: ${d.confidenceScore}%`, { bold: true }));
  }

  // Top matches
  const matches = d.topMatches ?? [];
  if (matches.length) {
    out.push(blank(), h2('Top Matching Projects'));
    out.push(dataTable(
      ['#', 'Project', 'Client', 'Match %', 'Value'],
      matches.slice(0, 10).map((m, i) => [
        `${i + 1}`,
        safe(m.project.title),
        safe(m.project.client),
        `${m.relevanceScore}%`,
        m.project.value ? `$${(m.project.value / 1_000_000).toFixed(1)}M` : '—',
      ]),
      [5, 30, 25, 15, 25],
    ));
  }

  // Gap analysis
  const gap = d.gapAnalysis;
  if (gap) {
    out.push(blank(), h2('Requirements Coverage'));
    out.push(p(`Overall Coverage: ${gap.overallCoverage}%`, { bold: true }));

    const covered = gap.coverageItems.filter((c) => c.status === 'COVERED').length;
    const partial = gap.coverageItems.filter((c) => c.status === 'PARTIAL').length;
    const gaps = gap.coverageItems.filter((c) => c.status === 'GAP').length;
    out.push(p(`Covered: ${covered} | Partial: ${partial} | Gaps: ${gaps}`));

    if (gap.criticalGaps.length) {
      out.push(blank(), h3('Critical Gaps'));
      out.push(...bullets(gap.criticalGaps.slice(0, 8)));
    }

    if (gap.recommendations.length) {
      out.push(blank(), h3('Recommendations'));
      out.push(...bullets(gap.recommendations.slice(0, 8)));
    }
  }

  return out;
};

const buildScoring = (brief: ExecutiveBriefItem): (Paragraph | Table)[] => {
  const d = brief.sections.scoring?.data;
  const out: (Paragraph | Table)[] = [h1('7. Bid Scoring & Recommendation')];
  if (!d) return [...out, p('No scoring data available.', { color: C.muted, italics: true })];
  const items: Array<{ label: string; value: string }> = [];
  if (d.compositeScore !== undefined) items.push({ label: 'Composite Score', value: `${d.compositeScore}/5` });
  if (d.recommendation) items.push({ label: 'Recommendation', value: d.recommendation });
  if (d.confidence !== undefined) items.push({ label: 'Confidence', value: `${d.confidence}%` });
  if (d.decision) items.push({ label: 'Decision', value: d.decision });
  if (items.length) { out.push(kvTable(items), blank()); }
  if (d.summaryJustification) {
    out.push(h2('Summary Justification'));
    for (const para of d.summaryJustification.split(/\n{2,}/)) { if (para.trim()) out.push(p(clip(para.trim(), 1500))); }
  }
  if (d.decisionRationale) {
    out.push(blank(), h2('Decision Rationale'));
    for (const para of d.decisionRationale.split(/\n{2,}/)) { if (para.trim()) out.push(p(clip(para.trim(), 1500))); }
  }
  if ((d.criteria ?? []).length) {
    out.push(blank(), h2('Scoring Criteria'));
    out.push(dataTable(['Criterion', 'Score', 'Rationale', 'Gaps'],
      (d.criteria ?? []).map((c) => [safe(c.name), c.score ? `${c.score}/5` : '—', clip(safe(c.rationale), 200), (c.gaps ?? []).slice(0, 3).join('; ') || '—']),
      [20, 10, 45, 25]));
  }
  if ((d.blockers ?? []).length) { out.push(blank(), h3('Blockers'), ...bullets(d.blockers?.slice(0, 10) ?? [])); }
  if ((d.requiredActions ?? []).length) { out.push(blank(), h3('Required Actions'), ...bullets(d.requiredActions?.slice(0, 10) ?? [])); }
  if ((d.confidenceDrivers ?? []).length) {
    out.push(blank(), h3('Confidence Drivers'));
    (d.confidenceDrivers ?? []).slice(0, 10).forEach((drv) => {
      const arrow = drv.direction === 'UP' ? '↑' : '↓';
      out.push(bullet(`${arrow} ${safe(drv.factor)}`, 0, { color: drv.direction === 'UP' ? C.success : C.danger }));
    });
  }
  return out;
};

// ─── Document builder ─────────────────────────────────────────────────────────

const buildBriefDocument = (projectName: string, brief: ExecutiveBriefItem): Document => {
  const sd = brief.sections.summary?.data;
  const headerText = `Executive Brief — ${safe(sd?.title ?? projectName, 'Project')}`;

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: FONT, size: HP(11), color: C.body },
          paragraph: { spacing: { line: 276 } },
        },
        heading1: {
          run: { font: FONT, size: HP(18), bold: true, color: C.primary },
          paragraph: { spacing: { before: TW(18), after: TW(6) } },
        },
        heading2: {
          run: { font: FONT, size: HP(14), bold: true, color: C.primary },
          paragraph: { spacing: { before: TW(14), after: TW(4) } },
        },
        heading3: {
          run: { font: FONT, size: HP(12), bold: true, color: C.dark },
          paragraph: { spacing: { before: TW(10), after: TW(3) } },
        },
      },
      paragraphStyles: [
        {
          id: 'TOC1',
          name: 'TOC 1',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: FONT, size: HP(12), color: C.dark, bold: true },
          paragraph: {
            spacing: { before: TW(6), after: TW(6), line: 276 },
            indent: { left: TW(0) },
          },
        },
        {
          id: 'TOC2',
          name: 'TOC 2',
          basedOn: 'Normal',
          next: 'Normal',
          run: { font: FONT, size: HP(11), color: C.body },
          paragraph: {
            spacing: { before: TW(3), after: TW(3), line: 276 },
            indent: { left: TW(20) },
          },
        },
      ],
    },
    sections: [
      // ── Cover page (no header/footer) ──
      {
        properties: {
          titlePage: true,
          page: { margin: { top: TW(72), bottom: TW(72), left: TW(90), right: TW(90) } },
        },
        headers: {
          first: new Header({ children: [] }), // empty header on cover
          default: new Header({
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                new TextRun({ text: headerText, size: HP(8), color: C.light, font: FONT, italics: true }),
              ],
            })],
          }),
        },
        footers: {
          first: new Footer({ children: [] }), // empty footer on cover
          default: new Footer({
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              border: { top: { style: BorderStyle.SINGLE, size: 1, color: C.softBorder, space: 4 } },
              children: [
                new TextRun({ text: 'Page ', size: HP(8), color: C.light, font: FONT }),
                new TextRun({ children: [PageNumber.CURRENT], size: HP(8), color: C.light, font: FONT }),
                new TextRun({ text: ' of ', size: HP(8), color: C.light, font: FONT }),
                new TextRun({ children: [PageNumber.TOTAL_PAGES], size: HP(8), color: C.light, font: FONT }),
                new TextRun({ text: '  |  CONFIDENTIAL', size: HP(8), color: C.light, font: FONT }),
              ],
            })],
          }),
        },
        children: [
          ...buildCover(projectName, brief),
          // Table of Contents
          new Paragraph({
            spacing: { before: TW(24), after: TW(18) },
            border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: C.accent, space: 6 } },
            children: [new TextRun({ text: 'Table of Contents', bold: true, size: HP(20), color: C.primary, font: FONT })],
          }),
          blank(),
          // Manual TOC entries — avoids Word field-code artifacts (PAGEREF numbers)
          ...[
            '1. Opportunity Summary',
            '2. Key Deadlines',
            '3. Requirements Analysis',
            '4. Key Contacts',
            '5. Risk Assessment',
            '6. Past Performance',
            '7. Bid Scoring & Recommendation',
          ].map((entry) => new Paragraph({
            style: 'TOC1',
            spacing: { before: TW(4), after: TW(4), line: 276 },
            children: [new TextRun({ text: entry, size: HP(12), color: C.dark, bold: true, font: FONT })],
          })),
          blank(),
          pb(),
          // ── Content sections ──
          ...buildSummary(brief),
          ...buildDeadlines(brief),
          ...buildRequirements(brief),
          ...buildContacts(brief),
          ...buildRisks(brief),
          ...buildPastPerformance(brief),
          ...buildScoring(brief),
        ],
      },
    ],
  });
};

// ─── Lambda handler ───────────────────────────────────────────────────────────

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is required' });
  }

  try {
    const rawBody = JSON.parse(event.body);
    const { success, data, error } = ExportBriefRequestSchema.safeParse(rawBody);

    if (!success) {
      return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
    }

    const { projectId, opportunityId, projectName, opportunityName } = data;
    const brief = await getExecutiveBriefByProjectId(projectId, opportunityId);

    // Use opportunity name (from request or brief summary title) as the document title
    const displayName = opportunityName
      || brief.sections.summary?.data?.title
      || projectName
      || 'Opportunity';

    const doc = buildBriefDocument(displayName, brief);
    const buffer = await Packer.toBuffer(doc);

    const sanitizedName = displayName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 80);
    const key = `exports/${projectId}/${opportunityId}/${sanitizedName}_Executive_Brief.docx`;

    await s3Client.send(new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }));

    const url = await getSignedUrl(s3Client as Parameters<typeof getSignedUrl>[0], new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: key,
    }), { expiresIn: PRESIGN_EXPIRES_IN });

    setAuditContext(event, {
      action: 'DATA_EXPORTED',
      resource: 'config',
      resourceId: projectId,
    });

    return apiResponse(200, {
      success: true,
      export: { format: 'docx', url, expiresIn: PRESIGN_EXPIRES_IN, fileName: `${sanitizedName}_Executive_Brief.docx` },
    });
  } catch (err: unknown) {
    console.error('Error exporting executive brief:', err);
    return apiResponse(500, {
      message: 'Failed to export executive brief',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);

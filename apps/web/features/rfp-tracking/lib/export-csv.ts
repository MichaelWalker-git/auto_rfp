import type { RfpPipelineItem } from '@auto-rfp/core';
import { OPPORTUNITY_STATUS_LABELS, OPPORTUNITY_APPROVAL_LABELS, RFP_STAGE_LABELS } from '@auto-rfp/core';
import { toBoardCard, resolveApprovalStatus, resolveStage } from './derive-board';
import { csvCell, slug } from './csv';

const HEADERS = [
  'Title',
  'Opportunity ID',
  'Board Stage',
  'Status',
  'Approval',
  'Owner',
  'Response Deadline',
  'Days To Deadline',
  'Days In Current Stage',
  'Value',
  'Source',
] as const;

/**
 * Client-side CSV export of the current pipeline, mirroring the Blob/URL pattern
 * used by features/dashboard/lib/export-analytics.ts.
 */
export const exportPipelineToCsv = (
  items: RfpPipelineItem[],
  orgName: string,
  nowIso: string,
): void => {
  const rows: (string | number | null)[][] = [
    [...HEADERS],
    ...items.map((item) => {
      const card = toBoardCard(item, nowIso);
      return [
        item.title ?? '',
        item.oppId ?? item.id,
        RFP_STAGE_LABELS[resolveStage(item)],
        item.status ? OPPORTUNITY_STATUS_LABELS[item.status] : '',
        OPPORTUNITY_APPROVAL_LABELS[resolveApprovalStatus(item)],
        item.assigneeName ?? '',
        item.responseDeadlineIso ?? '',
        // Raw numbers (or null) — csvCell keeps numbers numeric so a genuine
        // negative like an overdue -5 stays a number rather than becoming text.
        card.daysToDeadline,
        card.daysInCurrentStage,
        item.baseAndAllOptionsValue ?? null,
        item.source ?? '',
      ];
    }),
  ];

  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `rfp-pipeline-${slug(orgName)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

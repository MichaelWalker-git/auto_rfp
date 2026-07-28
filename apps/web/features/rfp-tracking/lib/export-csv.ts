import type { RfpPipelineItem } from '@auto-rfp/core';
import { OPPORTUNITY_STATUS_LABELS, OPPORTUNITY_APPROVAL_LABELS } from '@auto-rfp/core';
import { toBoardCard, resolveApprovalStatus } from './derive-board';

/** Escape a CSV cell — wrap in quotes and double any embedded quotes. */
const csvCell = (value: string | number | null | undefined): string => {
  const str = value === null || value === undefined ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
};

const HEADERS = [
  'Title',
  'Opportunity ID',
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
  const rows: string[][] = [
    [...HEADERS],
    ...items.map((item) => {
      const card = toBoardCard(item, nowIso);
      return [
        item.title ?? '',
        item.oppId ?? item.id,
        item.status ? OPPORTUNITY_STATUS_LABELS[item.status] : '',
        OPPORTUNITY_APPROVAL_LABELS[resolveApprovalStatus(item)],
        item.assigneeName ?? '',
        item.responseDeadlineIso ?? '',
        card.daysToDeadline !== null ? String(card.daysToDeadline) : '',
        card.daysInCurrentStage !== null ? String(card.daysInCurrentStage) : '',
        item.baseAndAllOptionsValue != null ? String(item.baseAndAllOptionsValue) : '',
        item.source ?? '',
      ];
    }),
  ];

  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  const safeOrg = orgName.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  link.download = `rfp-pipeline-${safeOrg || 'export'}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

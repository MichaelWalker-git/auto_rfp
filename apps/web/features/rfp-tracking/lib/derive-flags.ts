import type { RfpPipelineItem } from '@auto-rfp/core';
import { ACTIVE_OPPORTUNITY_STATUSES } from '@auto-rfp/core';
import { resolveApprovalStatus } from './derive-board';

export type FlagType =
  | 'SUBMITTED_WITHOUT_APPROVAL'
  | 'MISSING_OWNER'
  | 'MISSING_DEADLINE'
  | 'TERMINAL_MISSING_OUTCOME';

export interface AttentionFlag {
  type: FlagType;
  item: RfpPipelineItem;
  message: string;
}

export const FLAG_LABELS: Record<FlagType, string> = {
  SUBMITTED_WITHOUT_APPROVAL: 'Submitted without final approval',
  MISSING_OWNER: 'No owner assigned',
  MISSING_DEADLINE: 'No response deadline',
  TERMINAL_MISSING_OUTCOME: 'Closed without outcome detail',
};

const isActive = (item: RfpPipelineItem): boolean =>
  !!item.status && ACTIVE_OPPORTUNITY_STATUSES.includes(item.status);

/** Did the item's approval history ever pass through the given gate outcome? */
const passedGate = (item: RfpPipelineItem, to: 'I_APPROVED' | 'II_APPROVED'): boolean =>
  (item.approvalHistory ?? []).some((t) => t.to === to);

/**
 * Which approval gate(s) a Submitted item skipped. A properly-approved
 * submission clears gate 1 (I_APPROVED) then gate 2 (II_APPROVED); anything
 * missing is a governance gap.
 */
const skippedGates = (item: RfpPipelineItem): Array<'initial' | 'final'> => {
  const skipped: Array<'initial' | 'final'> = [];
  if (!passedGate(item, 'I_APPROVED')) skipped.push('initial');
  if (!passedGate(item, 'II_APPROVED')) skipped.push('final');
  return skipped;
};

/**
 * Native-data "Needs Attention" flags:
 * - SUBMITTED_WITHOUT_APPROVAL: approvalStatus is SUBMITTED but the approval
 *   history skipped gate 1 (I_APPROVED) and/or gate 2 (II_APPROVED).
 * - MISSING_OWNER / MISSING_DEADLINE: an active item lacking an assignee/deadline.
 * - TERMINAL_MISSING_OUTCOME: WON without winData, LOST without lossData.
 */
export const deriveFlags = (items: RfpPipelineItem[]): AttentionFlag[] => {
  const flags: AttentionFlag[] = [];

  for (const item of items) {
    const status = item.status;
    const approvalStatus = resolveApprovalStatus(item);
    const label = item.title || item.oppId || item.id;

    if (approvalStatus === 'SUBMITTED') {
      const skipped = skippedGates(item);
      if (skipped.length > 0) {
        const gateText =
          skipped.length === 2
            ? 'either approval gate'
            : skipped[0] === 'initial'
              ? 'initial approval'
              : 'final approval';
        flags.push({
          type: 'SUBMITTED_WITHOUT_APPROVAL',
          item,
          message: `"${label}" is marked Submitted without clearing ${gateText}.`,
        });
      }
    }

    if (isActive(item) && !item.assigneeId) {
      flags.push({
        type: 'MISSING_OWNER',
        item,
        message: `"${label}" is active but has no owner assigned.`,
      });
    }

    if (isActive(item) && !item.responseDeadlineIso) {
      flags.push({
        type: 'MISSING_DEADLINE',
        item,
        message: `"${label}" is active but has no response deadline.`,
      });
    }

    if (status === 'WON' && !item.winData) {
      flags.push({
        type: 'TERMINAL_MISSING_OUTCOME',
        item,
        message: `"${label}" is marked WON but is missing win detail.`,
      });
    }
    if (status === 'LOST' && !item.lossData) {
      flags.push({
        type: 'TERMINAL_MISSING_OUTCOME',
        item,
        message: `"${label}" is marked LOST but is missing loss detail.`,
      });
    }
  }

  return flags;
};

export const groupFlagsByType = (flags: AttentionFlag[]): Record<FlagType, AttentionFlag[]> => {
  const grouped = {
    SUBMITTED_WITHOUT_APPROVAL: [],
    MISSING_OWNER: [],
    MISSING_DEADLINE: [],
    TERMINAL_MISSING_OUTCOME: [],
  } as Record<FlagType, AttentionFlag[]>;

  for (const flag of flags) grouped[flag.type].push(flag);
  return grouped;
};

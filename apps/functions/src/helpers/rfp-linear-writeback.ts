import { linearGateLabelSwap, type OpportunityApprovalStatus, type OpportunityItem } from '@auto-rfp/core';
import { swapLinearGateLabelByIdentifier } from './linear';

/**
 * Mirror an RFP-tracking approval decision back onto the Linear board.
 *
 * The board is a mirror of the Linear "Government Contracting" project, resynced
 * every 15 minutes with Linear as the source of truth. So an approve/reject/advance
 * made in the dashboard only sticks if the corresponding Linear gate label is
 * updated — otherwise the next sync reverts it. This helper performs that
 * label swap (add the new gate label, remove the others) for the records the
 * sync owns; it is a no-op for opportunities that did not originate from Linear.
 *
 * Best-effort: a Linear failure is logged and swallowed so the DynamoDB
 * transition (already committed by the caller) is not rolled back. The caller
 * should surface a soft warning rather than failing the request.
 *
 * The Linear API key is stored in Secrets Manager under the *Linear* org id
 * (RFP_SYNC_LINEAR_ORG_ID) — the same key the sync Lambda uses — not the AutoRFP
 * org id.
 */
export const writeBackApprovalToLinear = async (args: {
  item: Pick<OpportunityItem, 'oppId' | 'id' | 'noticeId'>;
  to: OpportunityApprovalStatus;
}): Promise<{ updated: boolean; reason?: string }> => {
  const linearOrgId = process.env.RFP_SYNC_LINEAR_ORG_ID;
  if (!linearOrgId) {
    return { updated: false, reason: 'RFP_SYNC_LINEAR_ORG_ID not configured' };
  }

  // Only Linear-synced records carry a Linear identifier in `noticeId` and an
  // oppId of the form `linear-<identifier-lowercase>`.
  const oppId = args.item.oppId ?? args.item.id ?? '';
  const identifier = args.item.noticeId;
  if (!oppId.startsWith('linear-') || !identifier) {
    return { updated: false, reason: 'not a Linear-synced opportunity' };
  }

  const swap = linearGateLabelSwap(args.to);
  if (!swap) {
    // e.g. SUBMITTED — expressed by Linear workflow status, not a gate label.
    return { updated: false, reason: `no label mapping for ${args.to}` };
  }

  try {
    const updated = await swapLinearGateLabelByIdentifier(
      linearOrgId,
      identifier,
      swap.addLabel,
      swap.removeLabels,
    );
    return updated ? { updated: true } : { updated: false, reason: 'Linear issue not found' };
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[linear-writeback] Failed to update ${identifier} → ${args.to}:`, reason);
    return { updated: false, reason };
  }
};

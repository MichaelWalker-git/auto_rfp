/**
 * Build a version snapshot of the package for staleness detection.
 *
 * We don't freeze the opportunity during a review; instead we record each
 * document's / form's `updatedAt` at the moment the review started. If any of
 * those change afterwards, the review's findings were computed against content
 * that has since moved — the UI shows a "package changed, re-run" banner.
 */
import { listRFPDocumentsByProject } from '@/helpers/rfp-document';
import { listRequiredFormsByOpportunity } from '@/helpers/required-form';

export const buildPackageSnapshot = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
}): Promise<Record<string, string>> => {
  const { orgId, projectId, oppId } = args;
  const [docsRes, forms] = await Promise.all([
    listRFPDocumentsByProject({ projectId, opportunityId: oppId }),
    listRequiredFormsByOpportunity({ orgId, projectId, opportunityId: oppId }),
  ]);

  const snapshot: Record<string, string> = {};
  for (const doc of docsRes.items) {
    snapshot[`doc:${doc.documentId}`] = String(doc.updatedAt ?? '');
  }
  for (const form of forms) {
    snapshot[`form:${form.formId}`] = String(form.updatedAt ?? '');
  }
  return snapshot;
};

/** True if the current package differs from the snapshot (added/removed/changed). */
export const isSnapshotStale = (
  snapshot: Record<string, string>,
  current: Record<string, string>,
): boolean => {
  const snapKeys = Object.keys(snapshot);
  const curKeys = Object.keys(current);
  if (snapKeys.length !== curKeys.length) return true;
  for (const key of snapKeys) {
    if (snapshot[key] !== current[key]) return true;
  }
  return false;
};

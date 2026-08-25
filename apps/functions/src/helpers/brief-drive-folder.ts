import { getExecutiveBrief } from '@/helpers/executive-opportunity-brief';
import { getProjectById } from '@/helpers/project';
import { enqueueGoogleDriveSync } from '@/helpers/google-drive-queue';

/**
 * Outcome of an on-demand Google Drive folder request for an executive brief.
 * - `not_found`  — no brief with that id
 * - `exists`     — a folder was already created; the URL is handed back as-is
 * - `enqueued`   — a Drive sync job was placed on the queue
 */
export type DriveFolderResult =
  | { status: 'not_found' }
  | { status: 'exists'; googleDriveFolderUrl: string }
  | { status: 'enqueued'; executiveBriefId: string };

/**
 * On-demand Google Drive folder creation (HOR-2729 §2).
 *
 * Loads the brief, short-circuits idempotently if a folder URL already exists,
 * otherwise enqueues the async Drive sync. Shared by the "Create Drive folder"
 * action on the update-decision route (the standalone route was folded in to
 * stay under the API's integration cap).
 */
export const enqueueDriveFolderForBrief = async (
  executiveBriefId: string,
  orgId: string,
): Promise<DriveFolderResult> => {
  const brief = await getExecutiveBrief(executiveBriefId);
  if (!brief) {
    return { status: 'not_found' };
  }

  // Idempotent guard — the folder already exists, hand back the URL as-is.
  const existingFolderUrl = (brief as { googleDriveFolderUrl?: string }).googleDriveFolderUrl;
  if (existingFolderUrl) {
    return { status: 'exists', googleDriveFolderUrl: existingFolderUrl };
  }

  const summaryData = (brief.sections as any)?.summary?.data;
  const project = await getProjectById(brief.projectId);
  const projectName = (project as any)?.name || brief.projectId;

  await enqueueGoogleDriveSync({
    orgId,
    projectId: brief.projectId,
    opportunityId: brief.opportunityId as string,
    executiveBriefId,
    linearTicketId: brief.linearTicketId as string | undefined,
    linearTicketIdentifier: brief.linearTicketIdentifier as string | undefined,
    agencyName: summaryData?.agency,
    projectTitle: summaryData?.title || projectName,
  });

  return { status: 'enqueued', executiveBriefId };
};

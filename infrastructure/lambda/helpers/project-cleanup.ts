import { PROJECT_PK } from '../constants/organization';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { QUESTION_PK } from '../constants/question';
import { ANSWER_PK } from '../constants/answer';
import { EXEC_BRIEF_PK } from '../constants/exec-brief';
import { PROPOSAL_PK } from '../constants/proposal';
import { DEADLINE_PK } from '../constants/deadline';
import { OPPORTUNITY_PK } from '../constants/opportunity';
import { PK_NAME, SK_NAME } from '../constants/common';
import { requireEnv } from './env';
import {
  batchDeleteItems,
  deleteAllBySkPrefix,
  deleteItemWithRetry,
  getItem,
  queryAllBySkPrefix,
  scanByPkWithFilter,
} from './db';
import { deleteS3ObjectsFromKeys, safeS3Key } from './s3';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

interface QuestionFileItem {
  [PK_NAME]: string;
  [SK_NAME]: string;
  fileKey?: string;
  textFileKey?: string;
  executiveBriefId?: string;
}

interface ProjectItem {
  [PK_NAME]: string;
  [SK_NAME]: string;
  executiveBriefId?: string;
  projectId?: string;
}

export interface ProjectCleanupResult {
  questionFiles: { deleted: number; failed: number };
  questions: { deleted: number; failed: number };
  answers: { deleted: number; failed: number };
  proposals: { deleted: number; failed: number };
  opportunities: { deleted: number; failed: number };
  executiveBriefs: { deleted: number; failed: number };
  deadline: boolean;
  project: boolean;
  s3: { deleted: number; failed: number; skipped: number };
}

/**
 * Delete a project and all its related entities
 */
export async function deleteProjectAndRelatedEntities(
  orgId: string,
  projectId: string,
): Promise<ProjectCleanupResult> {
  const result: ProjectCleanupResult = {
    questionFiles: { deleted: 0, failed: 0 },
    questions: { deleted: 0, failed: 0 },
    answers: { deleted: 0, failed: 0 },
    proposals: { deleted: 0, failed: 0 },
    opportunities: { deleted: 0, failed: 0 },
    executiveBriefs: { deleted: 0, failed: 0 },
    deadline: false,
    project: false,
    s3: { deleted: 0, failed: 0, skipped: 0 },
  };

  // Verify project exists
  const projectSk = `${orgId}#${projectId}`;
  const project = await getItem<ProjectItem>(PROJECT_PK, projectSk);

  if (!project) {
    const err: any = new Error('Project not found');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  }

  // Get question files for S3 keys and exec brief IDs
  const questionFiles = await queryAllBySkPrefix<QuestionFileItem>(
    QUESTION_FILE_PK,
    `${projectId}#`,
  );

  // Delete S3 objects
  const s3Keys = collectS3Keys(questionFiles);
  if (s3Keys.length > 0) {
    result.s3 = await deleteS3ObjectsFromKeys(DOCUMENTS_BUCKET, s3Keys);
  }

  // Delete all related DynamoDB records
  result.questionFiles = await deleteAllBySkPrefix(QUESTION_FILE_PK, `${projectId}#`);
  result.questions = await deleteAllBySkPrefix(QUESTION_PK, `${projectId}#`);
  result.answers = await deleteAllBySkPrefix(ANSWER_PK, `${projectId}#`);
  result.proposals = await deleteAllBySkPrefix(PROPOSAL_PK, `${projectId}#`);
  
  // Delete opportunities (SK format: orgId#projectId#oppId)
  result.opportunities = await deleteAllBySkPrefix(OPPORTUNITY_PK, `${orgId}#${projectId}#`);

  // Delete executive briefs
  const execBriefIds = collectExecBriefIds(project, questionFiles);
  if (execBriefIds.length > 0) {
    result.executiveBriefs = await batchDeleteItems(
      execBriefIds.map((id) => ({ pk: EXEC_BRIEF_PK, sk: id })),
    );
  }

  // Scan for any remaining exec briefs with projectId
  const scannedBriefs = await scanByPkWithFilter<{ [PK_NAME]: string; [SK_NAME]: string }>(
    EXEC_BRIEF_PK,
    'projectId',
    projectId,
  );
  if (scannedBriefs.length > 0) {
    const scanned = await batchDeleteItems(
      scannedBriefs.map((item) => ({ pk: item[PK_NAME], sk: item[SK_NAME] })),
    );
    result.executiveBriefs.deleted += scanned.deleted;
    result.executiveBriefs.failed += scanned.failed;
  }

  // Delete deadline and project
  result.deadline = await deleteItemWithRetry(DEADLINE_PK, `${orgId}#${projectId}`);
  result.project = await deleteItemWithRetry(PROJECT_PK, projectSk);

  return result;
}

/**
 * Get all projects for an organization
 */
export async function getProjectsByOrgId(orgId: string): Promise<ProjectItem[]> {
  return queryAllBySkPrefix<ProjectItem>(PROJECT_PK, `${orgId}#`);
}

/**
 * Extract projectId from sort key (format: orgId#projectId)
 */
export function extractProjectIdFromSk(sk: string, orgId: string): string | null {
  const prefix = `${orgId}#`;
  return sk.startsWith(prefix) ? sk.slice(prefix.length) : null;
}

function collectS3Keys(items: QuestionFileItem[]): string[] {
  const keys: string[] = [];
  for (const item of items) {
    const fileKey = safeS3Key(item.fileKey);
    const textFileKey = safeS3Key(item.textFileKey);
    if (fileKey) keys.push(fileKey);
    if (textFileKey) keys.push(textFileKey);
  }
  return keys;
}

function collectExecBriefIds(
  project: ProjectItem | null,
  questionFiles: QuestionFileItem[],
): string[] {
  const ids = new Set<string>();
  if (project?.executiveBriefId?.trim()) ids.add(project.executiveBriefId.trim());
  for (const qf of questionFiles) {
    if (qf.executiveBriefId?.trim()) ids.add(qf.executiveBriefId.trim());
  }
  return Array.from(ids);
}
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import ExcelJS from 'exceljs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { requireEnv } from '@/helpers/env';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_PK } from '@/constants/question';
import { ANSWER_PK } from '@/constants/answer';
import { RFP_DOCUMENT_PK } from '@/constants/rfp-document';
import { docClient, queryAllBySkPrefix } from '@/helpers/db';
import { getQuestionFileItem } from '@/helpers/questionFile';
import { uploadToS3 } from '@/helpers/s3';
import { buildRFPDocumentSK, buildRFPDocumentS3Key, putRFPDocument } from '@/helpers/rfp-document';
import { nowIso } from '@/helpers/date';

const getTableName = () => requireEnv('DB_TABLE_NAME');
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

const s3Client = new S3Client({});

const GenerateQuestionnaireDTOSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  questionFileId: z.string().min(1),
});

const columnLetterToIndex = (col: string): number => {
  let index = 0;
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.toUpperCase().charCodeAt(i) - 64);
  }
  return index;
};

export const generateQuestionnaireDocument = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  const body = JSON.parse(event.body ?? '{}');
  const { success, data, error } = GenerateQuestionnaireDTOSchema.safeParse(body);

  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
  }

  const { orgId, projectId, opportunityId, questionFileId } = data;

  const qf = await getQuestionFileItem(projectId, opportunityId, questionFileId);
  if (!qf) {
    return apiResponse(404, { message: 'Question file not found' });
  }

  if (qf.docType !== 'QUESTIONNAIRE') {
    return apiResponse(400, { message: 'Question file is not classified as QUESTIONNAIRE' });
  }

  if (!qf.answerColumn || !qf.firstDataRow) {
    return apiResponse(400, { message: 'Question file missing questionnaire metadata (answerColumn, firstDataRow)' });
  }

  if (!qf.fileKey) {
    return apiResponse(400, { message: 'Question file has no source file' });
  }

  const bucket = getDocumentsBucket();

  const s3Obj = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: qf.fileKey }));
  const fileBuffer = Buffer.from(await s3Obj.Body!.transformToByteArray());

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer as unknown as ArrayBuffer);

  const worksheet = qf.sheetName
    ? workbook.getWorksheet(qf.sheetName) ?? workbook.worksheets[0]!
    : workbook.worksheets[0]!;

  const skPrefix = `${projectId}#${opportunityId}#${questionFileId}#`;
  const questions = await queryAllBySkPrefix<{
    [PK_NAME]: string;
    [SK_NAME]: string;
    questionId: string;
    sourceRow?: number;
    question?: string;
  }>(QUESTION_PK, skPrefix);

  const answers = await queryAllBySkPrefix<{
    [PK_NAME]: string;
    [SK_NAME]: string;
    questionId?: string;
    text?: string;
  }>(ANSWER_PK, skPrefix);

  const answerByQuestionId = new Map<string, string>();
  for (const a of answers) {
    if (a.questionId && a.text) {
      answerByQuestionId.set(a.questionId, a.text);
    }
  }

  const answerColIndex = columnLetterToIndex(qf.answerColumn);
  let filledCount = 0;

  for (const q of questions) {
    if (!q.sourceRow || !q.questionId) continue;

    const answerText = answerByQuestionId.get(q.questionId);
    if (!answerText) continue;

    const row = worksheet.getRow(q.sourceRow);
    const cell = row.getCell(answerColIndex);
    cell.value = answerText;
    filledCount++;
  }

  const outputBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

  const documentId = uuidv4();
  const originalName = qf.originalFileName ?? 'questionnaire.xlsx';
  const filledName = originalName.replace(/\.xlsx$/i, '-filled.xlsx');

  const fileKey = buildRFPDocumentS3Key({
    orgId,
    projectId,
    opportunityId,
    documentId,
    version: 1,
    fileName: filledName,
  });

  await uploadToS3(
    bucket,
    fileKey,
    outputBuffer,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );

  const now = nowIso();
  const userId = event.auth?.userId ?? 'system';
  const userName = (event.auth?.claims?.['name'] as string) ?? 'system';

  await putRFPDocument({
    [PK_NAME]: RFP_DOCUMENT_PK,
    [SK_NAME]: buildRFPDocumentSK(projectId, opportunityId, documentId),
    documentId,
    projectId,
    opportunityId,
    orgId,
    name: filledName,
    description: `Filled questionnaire from ${originalName} (${filledCount} answers)`,
    documentType: 'QUESTIONNAIRE',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileSizeBytes: outputBuffer.length,
    originalFileName: filledName,
    fileKey,
    version: 1,
    signatureStatus: 'NOT_REQUIRED',
    linearSyncStatus: 'NOT_SYNCED',
    status: 'READY',
    createdBy: userId,
    updatedBy: userId,
    createdByName: userName,
    updatedByName: userName,
    createdAt: now,
    updatedAt: now,
  });

  const downloadUrl = await getSignedUrl(
    s3Client as Parameters<typeof getSignedUrl>[0],
    new GetObjectCommand({ Bucket: bucket, Key: fileKey }),
    { expiresIn: 3600 },
  );

  return apiResponse(200, {
    documentId,
    fileKey,
    downloadUrl,
    filledCount,
    totalQuestions: questions.length,
  });
};

const baseHandler = middy(generateQuestionnaireDocument)
  .use(authContextMiddleware())
  .use(orgMembershipMiddleware())
  .use(requirePermission('proposal:create'))
  .use(httpErrorMiddleware());

export const handler = withSentryLambda(baseHandler);

import type { Context } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import ExcelJS from 'exceljs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_PK } from '@/constants/question';
import { ANSWER_PK } from '@/constants/answer';
import { RFP_DOCUMENT_PK } from '@/constants/rfp-document';
import { QUESTION_FILE_PK } from '@/constants/question-file';
import { queryAllBySkPrefix } from '@/helpers/db';
import { uploadToS3 } from '@/helpers/s3';
import { buildRFPDocumentSK, buildRFPDocumentS3Key, putRFPDocument, listRFPDocumentsByProject } from '@/helpers/rfp-document';
import { nowIso } from '@/helpers/date';

const getTableName = () => requireEnv('DB_TABLE_NAME');
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

const s3Client = new S3Client({});

export interface GenerateQuestionnaireExportsEvent {
  projectId: string;
  orgId?: string;
  opportunityId: string;
}

interface GenerateQuestionnaireExportsResult {
  generated: number;
  skipped: number;
}

const columnLetterToIndex = (col: string): number => {
  let index = 0;
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.toUpperCase().charCodeAt(i) - 64);
  }
  return index;
};

export const baseHandler = async (
  event: GenerateQuestionnaireExportsEvent,
  _ctx: Context,
): Promise<GenerateQuestionnaireExportsResult> => {
  const { projectId, orgId, opportunityId } = event;

  if (!projectId || !opportunityId) {
    console.log('Missing projectId or opportunityId, skipping');
    return { generated: 0, skipped: 0 };
  }

  const skPrefix = `${projectId}#${opportunityId}#`;
  const allFiles = await queryAllBySkPrefix<{
    [PK_NAME]: string;
    [SK_NAME]: string;
    questionFileId: string;
    docType?: string;
    questionColumn?: string;
    answerColumn?: string;
    firstDataRow?: number;
    sheetName?: string;
    fileKey?: string;
    originalFileName?: string;
    orgId?: string;
  }>(QUESTION_FILE_PK, skPrefix);

  const questionnaireFiles = allFiles.filter(
    (f) => f.docType === 'QUESTIONNAIRE' && f.answerColumn && f.firstDataRow && f.fileKey,
  );

  if (questionnaireFiles.length === 0) {
    console.log('No QUESTIONNAIRE files found for this opportunity');
    return { generated: 0, skipped: 0 };
  }

  // Check for existing QUESTIONNAIRE RFP documents to avoid regenerating unchanged files
  const existingDocs = await listRFPDocumentsByProject({ projectId, opportunityId });
  const existingQuestionnaireNames = new Set(
    existingDocs.items
      .filter((d) => d.documentType === 'QUESTIONNAIRE' && !d.deletedAt)
      .map((d) => d.originalFileName as string),
  );

  console.log(`Found ${questionnaireFiles.length} QUESTIONNAIRE file(s), ${existingQuestionnaireNames.size} already exported`);

  const bucket = getDocumentsBucket();
  let generated = 0;
  let skipped = 0;

  for (const qf of questionnaireFiles) {
    try {
      const resolvedOrgId = orgId ?? qf.orgId;
      if (!resolvedOrgId) {
        console.warn(`No orgId for file ${qf.questionFileId}, skipping`);
        skipped++;
        continue;
      }

      const expectedName = (qf.originalFileName ?? 'questionnaire.xlsx').replace(/\.xlsx$/i, '-filled.xlsx');
      if (existingQuestionnaireNames.has(expectedName)) {
        console.log(`Questionnaire export already exists for "${expectedName}", skipping`);
        skipped++;
        continue;
      }

      const questionSkPrefix = `${projectId}#${opportunityId}#${qf.questionFileId}#`;
      const questions = await queryAllBySkPrefix<{
        [PK_NAME]: string;
        [SK_NAME]: string;
        questionId: string;
        sourceRow?: number;
      }>(QUESTION_PK, questionSkPrefix);

      const answers = await queryAllBySkPrefix<{
        [PK_NAME]: string;
        [SK_NAME]: string;
        questionId?: string;
        text?: string;
      }>(ANSWER_PK, questionSkPrefix);

      if (answers.length === 0) {
        console.log(`No answers for file ${qf.questionFileId}, skipping`);
        skipped++;
        continue;
      }

      const answerByQuestionId = new Map<string, string>();
      for (const a of answers) {
        if (a.questionId && a.text) {
          answerByQuestionId.set(a.questionId, a.text);
        }
      }

      const s3Obj = await s3Client.send(new GetObjectCommand({ Bucket: bucket, Key: qf.fileKey! }));
      const fileBuffer = Buffer.from(await s3Obj.Body!.transformToByteArray());

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(fileBuffer as unknown as ArrayBuffer);

      const worksheet = qf.sheetName
        ? workbook.getWorksheet(qf.sheetName) ?? workbook.worksheets[0]!
        : workbook.worksheets[0]!;

      const answerColIndex = columnLetterToIndex(qf.answerColumn!);
      const questionColIndex = qf.questionColumn ? columnLetterToIndex(qf.questionColumn) : answerColIndex - 1;
      const firstDataRow = qf.firstDataRow ?? 1;

      // Build text-to-row map for reliable matching
      const questionTextToRow = new Map<string, number>();
      const validQuestionRows = new Set<number>();

      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber < firstDataRow) return;
        const questionCell = row.getCell(questionColIndex)?.value;
        const answerCell = row.getCell(answerColIndex)?.value;
        const questionText = questionCell ? String(questionCell).trim() : '';
        if (!questionText) return;

        const firstCol = row.getCell(1)?.value;
        const firstColStr = firstCol ? String(firstCol).trim() : '';
        if (firstColStr.toUpperCase().startsWith('SECTION') || firstColStr === '#') return;

        validQuestionRows.add(rowNumber);
        if (!answerCell || String(answerCell).trim() === '') {
          questionTextToRow.set(questionText.toLowerCase().slice(0, 200), rowNumber);
        }
      });

      let filledCount = 0;

      for (const q of questions) {
        if (!q.questionId) continue;
        const answerText = answerByQuestionId.get(q.questionId);
        if (!answerText) continue;

        const questionText = (q as { question?: string }).question ?? '';
        const normalizedQ = questionText.trim().toLowerCase().slice(0, 200);

        let targetRow: number | undefined;

        if (normalizedQ) {
          for (const [text, rowNum] of questionTextToRow) {
            if (text.startsWith(normalizedQ.slice(0, 50)) || normalizedQ.startsWith(text.slice(0, 50))) {
              targetRow = rowNum;
              break;
            }
          }
        }

        if (!targetRow && q.sourceRow && validQuestionRows.has(q.sourceRow)) {
          targetRow = q.sourceRow;
        }

        if (!targetRow || !validQuestionRows.has(targetRow)) continue;

        const existingAnswer = worksheet.getRow(targetRow).getCell(answerColIndex)?.value;
        if (existingAnswer && String(existingAnswer).trim().length > 0) continue;

        worksheet.getRow(targetRow).getCell(answerColIndex).value = answerText;
        questionTextToRow.delete(normalizedQ);
        filledCount++;
      }

      if (filledCount === 0) {
        console.log(`No answers mapped to rows for file ${qf.questionFileId}, skipping`);
        skipped++;
        continue;
      }

      const outputBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

      const documentId = uuidv4();
      const originalName = qf.originalFileName ?? 'questionnaire.xlsx';
      const filledName = originalName.replace(/\.xlsx$/i, '-filled.xlsx');

      const fileKey = buildRFPDocumentS3Key({
        orgId: resolvedOrgId,
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

      await putRFPDocument({
        [PK_NAME]: RFP_DOCUMENT_PK,
        [SK_NAME]: buildRFPDocumentSK(projectId, opportunityId, documentId),
        documentId,
        projectId,
        opportunityId,
        orgId: resolvedOrgId,
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
        createdBy: 'system',
        updatedBy: 'system',
        createdByName: 'AutoRFP Pipeline',
        updatedByName: 'AutoRFP Pipeline',
        createdAt: now,
        updatedAt: now,
      });

      console.log(`Generated QUESTIONNAIRE document ${documentId} for file ${qf.questionFileId} (${filledCount} answers filled)`);
      generated++;
    } catch (err) {
      console.error(`Failed to generate questionnaire export for file ${qf.questionFileId}:`, err);
      skipped++;
    }
  }

  return { generated, skipped };
};

export const handler = withSentryLambda(baseHandler);

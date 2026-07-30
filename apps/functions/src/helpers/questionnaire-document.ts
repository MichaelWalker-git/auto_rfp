import ExcelJS from 'exceljs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

import { requireEnv } from '@/helpers/env';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_PK } from '@/constants/question';
import { ANSWER_PK } from '@/constants/answer';
import { QUESTION_FILE_PK } from '@/constants/question-file';
import { RFP_DOCUMENT_PK } from '@/constants/rfp-document';
import { queryAllBySkPrefix, updateItem } from '@/helpers/db';
import { uploadToS3 } from '@/helpers/s3';
import { buildRFPDocumentS3Key, buildRFPDocumentSK } from '@/helpers/rfp-document';
import { columnLetterToIndex } from '@/helpers/excel';

const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

const s3Client = new S3Client({});


interface GenerateQuestionnaireDocumentArgs {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
}

export const generateQuestionnaireDocument = async ({
  orgId,
  projectId,
  opportunityId,
  documentId,
}: GenerateQuestionnaireDocumentArgs): Promise<void> => {
  const bucket = getDocumentsBucket();

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
  }>(QUESTION_FILE_PK, skPrefix);

  const questionnaireFiles = allFiles.filter(
    (f) => f.docType === 'QUESTIONNAIRE' && f.answerColumn && f.firstDataRow && f.fileKey,
  );

  if (questionnaireFiles.length === 0) {
    throw new Error('No QUESTIONNAIRE files found for this opportunity');
  }

  const qf = questionnaireFiles[0]!;

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

  // Build a map of normalized question text -> row number
  // Only include rows that are actual question rows (have content in question column
  // and the answer column is empty)
  const questionTextToRow = new Map<string, number>();
  const validQuestionRows = new Set<number>();

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber < firstDataRow) return;

    const questionCell = row.getCell(questionColIndex)?.value;
    const answerCell = row.getCell(answerColIndex)?.value;
    const questionText = questionCell ? String(questionCell).trim() : '';

    // Skip rows without question text
    if (!questionText) return;

    // Skip section headers: rows where question column has text but it looks like a header
    // (no question number in first column, or text starts with "SECTION")
    const firstCol = row.getCell(1)?.value;
    const firstColStr = firstCol ? String(firstCol).trim() : '';
    if (firstColStr.toUpperCase().startsWith('SECTION') || firstColStr === '#') return;

    // Valid question row: has question text and answer column is empty
    validQuestionRows.add(rowNumber);
    if (!answerCell || String(answerCell).trim() === '') {
      const normalized = questionText.toLowerCase().slice(0, 200);
      questionTextToRow.set(normalized, rowNumber);
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

    // Try text matching first
    if (normalizedQ) {
      for (const [text, rowNum] of questionTextToRow) {
        if (text.startsWith(normalizedQ.slice(0, 50)) || normalizedQ.startsWith(text.slice(0, 50))) {
          targetRow = rowNum;
          break;
        }
      }
    }

    // Fallback to sourceRow if text match failed, but only if it's a valid question row
    if (!targetRow && q.sourceRow && validQuestionRows.has(q.sourceRow)) {
      targetRow = q.sourceRow;
    }

    if (!targetRow) continue;

    // Final safety: only write to valid question rows with empty answer cells
    if (!validQuestionRows.has(targetRow)) continue;
    const existingAnswer = worksheet.getRow(targetRow).getCell(answerColIndex)?.value;
    if (existingAnswer && String(existingAnswer).trim().length > 0) continue;

    worksheet.getRow(targetRow).getCell(answerColIndex).value = answerText;
    questionTextToRow.delete(normalizedQ); // Prevent double-filling
    filledCount++;
  }

  const outputBuffer = Buffer.from(await workbook.xlsx.writeBuffer());

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

  const sk = buildRFPDocumentSK(projectId, opportunityId, documentId);
  await updateItem(RFP_DOCUMENT_PK, sk, {
    fileKey,
    fileSizeBytes: outputBuffer.length,
    originalFileName: filledName,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    description: `Filled questionnaire from ${originalName} (${filledCount} answers)`,
    status: 'READY',
    updatedBy: 'system',
  });

  console.log(`Generated QUESTIONNAIRE document ${documentId}: ${filledCount} answers filled`);
};

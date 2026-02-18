import * as XLSX from 'xlsx';
import { requireEnv } from '@/helpers/env';
import { getFileFromS3, uploadToS3 } from '@/helpers/s3';
import { withSentryLambda } from '@/sentry-lambda';
import { updateQuestionFile, checkQuestionFileCancelled } from '@/helpers/questionFile';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const streamToBuffer = async (stream: any) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
};

type Event = {
  opportunityId: string;
  projectId: string;
  questionFileId: string;
  sourceFileKey: string;
};

/**
 * Convert an XLSX/XLS workbook to plain text.
 * Each sheet is separated by a header line, and rows are tab-separated.
 */
function workbookToText(workbook: XLSX.WorkBook): string {
  const lines: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    lines.push(`\n=== Sheet: ${sheetName} ===\n`);

    // Convert sheet to array of arrays (row → cells)
    const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    for (const row of rows) {
      const line = row.map((cell) => String(cell ?? '').trim()).join('\t');
      if (line.trim()) lines.push(line);
    }
  }

  return lines.join('\n');
}

const baseHandler = async (event: Event) => {
  console.log('extract-xlsx-text event', event);
  const { sourceFileKey, projectId, questionFileId, opportunityId } = event;

  const isCancelled = await checkQuestionFileCancelled(projectId, opportunityId, questionFileId);
  if (isCancelled) {
    console.log(`Pipeline cancelled for ${questionFileId}, skipping processing`);
    return { textFileKey: '', cancelled: true };
  }

  const body = await getFileFromS3(DOCUMENTS_BUCKET, sourceFileKey);
  const buf = await streamToBuffer(body);

  const workbook = XLSX.read(buf, { type: 'buffer' });
  const text = workbookToText(workbook);

  const textFileKey = `pr/${projectId}/opp/${opportunityId}/qf/${questionFileId}.txt`;

  await uploadToS3(DOCUMENTS_BUCKET, textFileKey, text, 'text/plain; charset=utf-8');

  await updateQuestionFile(projectId, opportunityId, questionFileId, {
    status: 'TEXT_READY',
    textFileKey,
  });

  return { textFileKey, cancelled: false };
};

export const handler = withSentryLambda(baseHandler);

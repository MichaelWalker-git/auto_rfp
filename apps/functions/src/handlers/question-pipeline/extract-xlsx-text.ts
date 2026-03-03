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

// Max text output size — keeps Lambda memory usage bounded and avoids S3 upload timeouts
const MAX_TEXT_CHARS = 500_000;

/**
 * Convert an XLSX/XLS workbook to plain text.
 * Each sheet is separated by a header line, and rows are tab-separated.
 * Truncates output at MAX_TEXT_CHARS to avoid memory/timeout issues with huge files.
 */
function workbookToText(workbook: XLSX.WorkBook): string {
  const parts: string[] = [];
  let totalChars = 0;

  for (const sheetName of workbook.SheetNames) {
    if (totalChars >= MAX_TEXT_CHARS) break;

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const header = `\n=== Sheet: ${sheetName} ===\n`;
    parts.push(header);
    totalChars += header.length;

    // Convert sheet to array of arrays (row → cells)
    const rows: string[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      blankrows: false,
    });

    for (const row of rows) {
      if (totalChars >= MAX_TEXT_CHARS) {
        parts.push('\n[Truncated — file too large]');
        break;
      }
      const line = row.map((cell) => String(cell ?? '').trim()).join('\t');
      if (line.trim()) {
        parts.push(line);
        totalChars += line.length + 1;
      }
    }
  }

  return parts.join('\n');
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

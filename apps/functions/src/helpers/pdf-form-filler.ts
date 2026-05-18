import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { uploadToS3 } from './s3';
import { requireEnv } from './env';

import type { DetectedFormField } from '@auto-rfp/core';

const s3 = new S3Client({});
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

export const fillPdfForm = async (args: {
  sourceFileKey: string;
  fields: DetectedFormField[];
  outputKey: string;
}): Promise<string> => {
  const { sourceFileKey, fields, outputKey } = args;
  const bucket = getDocumentsBucket();

  const s3Obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: sourceFileKey }));
  const bytes = await s3Obj.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Could not read PDF from S3: ${sourceFileKey}`);

  // Try loading without encryption first (clean PDFs).
  // If encrypted, load with ignoreEncryption and write directly on original.
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(bytes);
  } catch {
    pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  const filledFields = fields.filter((f) => f.value && f.boundingBox && f.status !== 'MANUAL_REQUIRED');

  for (const field of filledFields) {
    if (!field.boundingBox || !field.value) continue;

    const pageNum = (field.pageNumber ?? 1) - 1;
    const page = pages[pageNum];
    if (!page) continue;

    const { width: pageWidth, height: pageHeight } = page.getSize();
    const bbox = field.boundingBox;

    // Bounding boxes are normalized (0-1) with origin top-left.
    // PDF coordinates have origin bottom-left.
    const x = bbox.left * pageWidth;
    const w = bbox.width * pageWidth;
    const h = bbox.height * pageHeight;

    // Position text at the top of the bbox (where the underline starts)
    // bbox.top is distance from page top, so PDF y = pageHeight - bbox.top * pageHeight
    // Then offset down by fontSize to place text baseline on the line
    const fontSize = Math.min(h * 0.8, 11);
    const y = pageHeight - (bbox.top * pageHeight) - fontSize;

    page.drawText(field.value, {
      x: x + 2,
      y,
      size: fontSize,
      font,
      color: rgb(0, 0, 0.6),
      maxWidth: w - 4,
    });
  }

  const filledBytes = await pdfDoc.save();
  await uploadToS3(bucket, outputKey, Buffer.from(filledBytes), 'application/pdf');

  return outputKey;
};

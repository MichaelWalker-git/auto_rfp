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

  const pdfDoc = await PDFDocument.load(bytes);
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

    // Textract bounding boxes are normalized (0-1). Convert to page coordinates.
    const x = bbox.left * pageWidth;
    const y = pageHeight - (bbox.top * pageHeight) - (bbox.height * pageHeight);
    const w = bbox.width * pageWidth;
    const h = bbox.height * pageHeight;

    const fontSize = Math.min(h * 0.7, 11);

    page.drawText(field.value, {
      x: x + 2,
      y: y + (h - fontSize) / 2,
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

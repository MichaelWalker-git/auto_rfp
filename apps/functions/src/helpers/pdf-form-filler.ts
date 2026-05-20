import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { uploadToS3 } from './s3';
import { requireEnv } from './env';
import { rasterizeAndFillPdf } from './pdf-rasterize-fill';

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
  // Encrypted PDFs go through a rasterize-then-stamp fallback because pdf-lib's
  // ignoreEncryption + strip-Encrypt path produces an output PDF without page
  // content streams (blank background + only our overlaid text).
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await PDFDocument.load(bytes);
  } catch (err) {
    console.log(`[fillPdfForm] PDF appears encrypted (${(err as Error)?.message}); using rasterize fallback`);
    return rasterizeAndFillPdf({ sourceFileKey, fields, outputKey });
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  // Export every field that has a value and a bbox — including MANUAL_REQUIRED
  // ones the user filled in (e.g. signature lines, dates, contract numbers).
  // Blank manual fields are skipped naturally because they have no value.
  const filledFields = fields.filter((f) => f.value && f.boundingBox);

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

    // Anchor the text baseline near the BOTTOM of the bbox (matching how a user
    // writes on an underline) — this is where the HTML viewer's <input> renders too.
    // Reserve ~20% of bbox height for descender so glyphs sit on the line.
    const fontSize = Math.min(h * 0.8, 11);
    const bboxBottomFromPdfBottom = pageHeight - (bbox.top + bbox.height) * pageHeight;
    const y = bboxBottomFromPdfBottom + h * 0.2;

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

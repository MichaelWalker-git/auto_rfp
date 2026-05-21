import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { uploadToS3 } from './s3';
import { requireEnv } from './env';

import type { DetectedFormField } from '@auto-rfp/core';

const s3 = new S3Client({});
const lambdaClient = new LambdaClient({});
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');
const getRasterizeFunctionName = () =>
  process.env.RASTERIZE_PDF_FUNCTION_NAME || '';

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
    console.log(`[fillPdfForm] PDF appears encrypted (${(err as Error)?.message}); delegating to rasterize worker`);
    // Encrypted PDFs require pdfjs + canvas to rasterize and re-stamp. Those
    // deps are too heavy (~110 MB) to bundle into every Lambda that calls
    // fillPdfForm — they live in a dedicated rasterize-pdf worker that we
    // invoke synchronously here.
    const fnName = getRasterizeFunctionName();
    if (!fnName) {
      throw new Error('RASTERIZE_PDF_FUNCTION_NAME env var not set; cannot rasterize encrypted PDF');
    }
    const res = await lambdaClient.send(new InvokeCommand({
      FunctionName: fnName,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify({ sourceFileKey, fields, outputKey })),
    }));
    if (res.FunctionError) {
      const text = res.Payload ? Buffer.from(res.Payload).toString('utf8') : '';
      throw new Error(`Rasterize worker failed: ${res.FunctionError}: ${text}`);
    }
    const payload = res.Payload ? Buffer.from(res.Payload).toString('utf8') : '';
    let parsed: { outputKey?: string; error?: string } = {};
    try { parsed = JSON.parse(payload); } catch { /* ignore */ }
    if (parsed.error) throw new Error(`Rasterize worker error: ${parsed.error}`);
    return parsed.outputKey ?? outputKey;
  }

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  // Export every field that has a value and a bbox — including MANUAL_REQUIRED
  // ones the user filled in (e.g. signature lines, dates, contract numbers).
  // Blank manual fields are skipped naturally because they have no value.
  // Also process mark fields (CHECKBOX/CIRCLE) regardless of `value`, since
  // the mark itself is the user's response.
  const filledFields = fields.filter((f) => {
    if (f.markType === 'CIRCLE' && f.markGeometry) return true;
    if (f.markType === 'CHECKBOX' && f.markChar && f.boundingBox) return true;
    return f.value && f.boundingBox;
  });

  for (const field of filledFields) {
    const pageNum = (field.pageNumber ?? 1) - 1;
    const page = pages[pageNum];
    if (!page) continue;

    const { width: pageWidth, height: pageHeight } = page.getSize();

    // Mark: CIRCLE — draw an unfilled ellipse at markGeometry.
    if (field.markType === 'CIRCLE' && field.markGeometry) {
      const { cx, cy, radius } = field.markGeometry;
      page.drawEllipse({
        x: cx * pageWidth,
        y: pageHeight - cy * pageHeight,
        xScale: radius * pageWidth,
        yScale: radius * pageHeight,
        borderColor: rgb(0.85, 0.1, 0.1),
        borderWidth: 1.5,
      });
      continue;
    }

    if (!field.boundingBox) continue;
    const bbox = field.boundingBox;
    const x = bbox.left * pageWidth;
    const w = bbox.width * pageWidth;
    const h = bbox.height * pageHeight;
    const bboxBottomFromPdfBottom = pageHeight - (bbox.top + bbox.height) * pageHeight;

    // Mark: CHECKBOX — draw the markChar (typically 'X') centered in the bbox.
    if (field.markType === 'CHECKBOX' && field.markChar) {
      const fontSize = Math.min(h * 0.9, 14);
      const charWidth = font.widthOfTextAtSize(field.markChar, fontSize);
      page.drawText(field.markChar, {
        x: x + (w - charWidth) / 2,
        y: bboxBottomFromPdfBottom + (h - fontSize * 0.7) / 2,
        size: fontSize,
        font,
        color: rgb(0.85, 0.1, 0.1),
      });
      continue;
    }

    if (!field.value) continue;

    // Text field: anchor the text baseline near the BOTTOM of the bbox.
    const fontSize = Math.min(h * 0.8, 11);
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

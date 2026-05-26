import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { uploadToS3 } from './s3';
import { requireEnv } from './env';

import type { DetectedFormField } from '@auto-rfp/core';
import { parsePageRange } from '@auto-rfp/core';

const s3 = new S3Client({});
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

/**
 * Fallback PDF filler that rasterizes each page (via pdfjs-dist + @napi-rs/canvas)
 * and stamps field values on top with pdf-lib. Used for encrypted source PDFs that
 * pdf-lib can't load cleanly.
 *
 * Output is image-based (not text-searchable) but always renders.
 */
export const rasterizeAndFillPdf = async (args: {
  sourceFileKey: string;
  fields: DetectedFormField[];
  outputKey: string;
  /**
   * Page range to slice from the source PDF (e.g. "17-19"). When provided,
   * only those pages are rasterized into the output. Mirrors fillPdfForm so
   * the encrypted-PDF fallback produces the same shape of output as the
   * regular path. See {@link fillPdfForm} for context.
   */
  sourcePageRange?: string | null;
}): Promise<string> => {
  const { sourceFileKey, fields, outputKey, sourcePageRange } = args;
  const bucket = getDocumentsBucket();

  const s3Obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: sourceFileKey }));
  const bytes = await s3Obj.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Could not read PDF from S3: ${sourceFileKey}`);

  const { createCanvas } = await import('@napi-rs/canvas');
  // Use the legacy build because the modern build uses ESM-only worker patterns
  // that don't load cleanly in a Lambda runtime. Preload the worker module and
  // hand it to GlobalWorkerOptions.workerPort so pdfjs skips its "fake worker"
  // setup path (which expects workerSrc to be an HTTP URL).
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // @ts-expect-error — no published types for the worker bundle
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs');

  const loadingTask = (pdfjs as unknown as {
    getDocument: (params: {
      data: Uint8Array;
      isEvalSupported: boolean;
      useWorkerFetch: boolean;
      disableFontFace: boolean;
      verbosity: number;
    }) => { promise: Promise<unknown> };
  }).getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useWorkerFetch: false,
    disableFontFace: true,
    // 0 = errors only — pdfjs is otherwise extremely chatty in Lambda logs
    verbosity: 0,
  });
  const pdf = await loadingTask.promise as {
    numPages: number;
    getPage: (n: number) => Promise<{
      getViewport: (opts: { scale: number }) => { width: number; height: number };
      render: (ctx: { canvasContext: unknown; viewport: unknown }) => { promise: Promise<void> };
    }>;
  };

  const outputPdf = await PDFDocument.create();
  const font = await outputPdf.embedFont(StandardFonts.Helvetica);

  // Render each source page to PNG, embed as a full-page image, then stamp text.
  // Export every field that has a value and a bbox — see pdf-form-filler.ts for
  // why we no longer exclude MANUAL_REQUIRED fields.
  const fieldsByPage = new Map<number, DetectedFormField[]>();
  for (const f of fields) {
    if (!f.value || !f.boundingBox) continue;
    const p = f.pageNumber ?? 1;
    const arr = fieldsByPage.get(p);
    if (arr) arr.push(f);
    else fieldsByPage.set(p, [f]);
  }

  const SCALE = 2; // 2x raster looks sharper at print size

  const allowedPages = parsePageRange(sourcePageRange);

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    if (allowedPages && !allowedPages.has(pageNum)) continue;
    const srcPage = await pdf.getPage(pageNum);
    const viewport = srcPage.getViewport({ scale: SCALE });

    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');

    await srcPage.render({ canvasContext: ctx, viewport }).promise;

    const pngBuffer = canvas.toBuffer('image/png');
    const embeddedImage = await outputPdf.embedPng(pngBuffer);

    // Output page sized to the source page (scale=1 dimensions, in PDF points)
    const pagePoints = srcPage.getViewport({ scale: 1 });
    const outPage = outputPdf.addPage([pagePoints.width, pagePoints.height]);
    outPage.drawImage(embeddedImage, {
      x: 0,
      y: 0,
      width: pagePoints.width,
      height: pagePoints.height,
    });

    const pageFields = fieldsByPage.get(pageNum) ?? [];
    for (const field of pageFields) {
      if (!field.boundingBox || !field.value) continue;
      const bbox = field.boundingBox;

      const x = bbox.left * pagePoints.width;
      const w = bbox.width * pagePoints.width;
      const h = bbox.height * pagePoints.height;
      const fontSize = Math.min(h * 0.8, 11);
      const bboxBottomFromPdfBottom = pagePoints.height - (bbox.top + bbox.height) * pagePoints.height;
      const y = bboxBottomFromPdfBottom + h * 0.2;

      outPage.drawText(field.value, {
        x: x + 2,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0.6),
        maxWidth: w - 4,
      });
    }
  }

  const filledBytes = await outputPdf.save();
  await uploadToS3(bucket, outputKey, Buffer.from(filledBytes), 'application/pdf');
  return outputKey;
};

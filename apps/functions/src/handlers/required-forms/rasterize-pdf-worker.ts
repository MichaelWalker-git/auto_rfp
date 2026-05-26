/**
 * Rasterize-and-stamp worker.
 *
 * Encrypted PDFs can't be opened with pdf-lib's standard path — we have to
 * render each page to a canvas and stamp our text/marks back on top. That
 * requires pdfjs-dist + @napi-rs/canvas, ~110 MB combined. Hosting them in
 * every Lambda that touches fillPdfForm pushed export-all over the 250 MB
 * unzipped Lambda limit, so the heavy deps live here instead and other
 * Lambdas synchronously invoke this worker via lambda:Invoke.
 *
 * Input  : { sourceFileKey, fields, outputKey }
 * Output : { outputKey } on success, { error } on failure
 */

import { withSentryLambda } from '@/sentry-lambda';
import { rasterizeAndFillPdf } from '@/helpers/pdf-rasterize-fill';

import type { DetectedFormField } from '@auto-rfp/core';

interface RasterizePdfEvent {
  sourceFileKey: string;
  fields: DetectedFormField[];
  outputKey: string;
}

interface RasterizePdfResult {
  outputKey?: string;
  error?: string;
}

export const baseHandler = async (event: RasterizePdfEvent): Promise<RasterizePdfResult> => {
  if (!event?.sourceFileKey || !event?.outputKey) {
    return { error: 'sourceFileKey and outputKey are required' };
  }
  try {
    const out = await rasterizeAndFillPdf({
      sourceFileKey: event.sourceFileKey,
      fields: event.fields ?? [],
      outputKey: event.outputKey,
    });
    return { outputKey: out };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[rasterize-pdf-worker] failed:', message);
    return { error: message };
  }
};

export const handler = withSentryLambda(baseHandler);

import { loadTextFromS3, tryLoadTextFromS3 } from '@/helpers/s3';
import { buildTxtKeyNextToOriginal } from '@/helpers/document-keys';

/** The fields of a document record needed to locate its extracted text. */
export interface DocumentTextSource {
  textFileKey?: string;
  fileKey?: string;
}

/**
 * The S3 keys a document's extracted text may live under, most authoritative
 * first.
 *
 * `textFileKey` is what the pipeline recorded and is normally the only
 * candidate. The `fileKey`-derived key covers documents created before the
 * upload path stopped guessing `textFileKey`: those records kept the guess
 * `<file>.<ext>.txt` while the pipeline had stored the text at `<file>.txt`,
 * so reading them by `textFileKey` alone 404s and the document looks
 * unreadable.
 */
export const buildTextKeyCandidates = (doc: DocumentTextSource): string[] => {
  const candidates = [
    doc.textFileKey,
    doc.fileKey ? buildTxtKeyNextToOriginal(doc.fileKey) : undefined,
  ].filter((key): key is string => !!key);

  return [...new Set(candidates)];
};

/**
 * Load a document's extracted text, trying each candidate key once before
 * falling back to a retrying read of the last candidate tried — so a transient
 * S3 failure still gets the usual retries and a genuinely missing object still
 * throws with a candidate key named.
 *
 * Returns `''` when the document has no key to read from at all.
 */
export const loadDocumentText = async (
  bucket: string,
  doc: DocumentTextSource,
): Promise<string> => {
  const candidates = buildTextKeyCandidates(doc);
  if (candidates.length === 0) return '';

  let lastKey = candidates[0];
  for (const key of candidates) {
    lastKey = key;
    const text = await tryLoadTextFromS3(bucket, key);
    if (text?.trim()) return text;
  }

  return await loadTextFromS3(bucket, lastKey);
};

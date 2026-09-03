/**
 * RFC 5987 percent-encoding for the `filename*` extended parameter.
 * `encodeURIComponent` leaves `!'()*` unescaped, but `*`, `'`, and `(`, `)`
 * are not valid `attr-char` per RFC 5987 and must be percent-encoded too.
 */
export const encodeRFC5987ValueChars = (value: string): string =>
  encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Builds a `Content-Disposition` header value with both a `filename` ASCII
 * fallback (for older clients) and an RFC-5987 `filename*` UTF-8 form, so
 * non-ASCII document names still download with their real name.
 */
export const buildContentDispositionHeader = (
  filename: string,
  disposition: 'attachment' | 'inline' = 'attachment',
): string => {
  const asciiFallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const encodedName = encodeRFC5987ValueChars(filename);
  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`;
};

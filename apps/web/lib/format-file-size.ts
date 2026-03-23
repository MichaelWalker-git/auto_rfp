/**
 * Format a file size in bytes to a human-readable string.
 * Examples: 1024 → "1.0 KB", 1048576 → "1.0 MB", 0 → "0 B"
 */
export const formatFileSize = (bytes: number | undefined | null): string | null => {
  if (bytes === undefined || bytes === null) return null;
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);

  // Show decimals only for MB and above
  const decimals = i >= 2 ? 1 : 0;
  return `${size.toFixed(decimals)} ${units[i]}`;
};

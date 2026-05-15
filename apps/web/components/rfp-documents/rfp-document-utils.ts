/**
 * Strip leftover AI scaffold comments from HTML before rendering in the editor.
 * These comments (e.g. `<!-- TEMPLATE SCAFFOLD: ... -->`) can be left behind by
 * the generation pipeline. Unclosed comments cause the browser/editor to treat
 * all subsequent content as invisible comment nodes.
 *
 * Handles both closed comments (with -->) and unclosed comments (without -->).
 */
export const sanitizeGeneratedHtml = (html: string): string => {
  if (!html) return html;
  return html
    // Closed scaffold comments (properly terminated with -->)
    .replace(/<!--\s*TEMPLATE SCAFFOLD:[\s\S]*?-->\s*/gi, '')
    .replace(/<!--\s*PRESERVE THIS IMAGE TAG EXACTLY AS-IS\s*-->\s*/gi, '')
    .replace(/<!--\s*PRESERVE THIS STYLE BLOCK EXACTLY AS-IS\s*-->\s*/gi, '')
    .replace(/<!--\s*PRESERVE THIS STYLE LINK EXACTLY AS-IS\s*-->\s*/gi, '')
    .replace(/<!--\s*PRESERVE STYLING\s*-->\s*/gi, '')
    .replace(/<!--\s*Section guidance:[\s\S]*?-->\s*/gi, '')
    // Unclosed scaffold comments (no --> terminator) — strip from <!-- to end of line
    // These are critical to remove: an unclosed <!-- makes the browser hide all content after it
    .replace(/<!--\s*TEMPLATE SCAFFOLD:[^\n]*\n?/gi, '')
    .replace(/<!--\s*PRESERVE THIS IMAGE TAG[^\n]*\n?/gi, '')
    .replace(/<!--\s*PRESERVE THIS STYLE[^\n]*\n?/gi, '')
    .replace(/<!--\s*PRESERVE STYLING[^\n]*\n?/gi, '')
    .replace(/<!--\s*Section guidance:[^\n]*\n?/gi, '')
    .trim();
};

export function formatDate(dateString?: string): string {
  if (!dateString) return '—';
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

const DOCUMENT_TYPE_STYLES: Record<string, { cls: string }> = {
  // Core Proposal Sections
  COVER_LETTER: { cls: 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800' },
  EXECUTIVE_SUMMARY: { cls: 'bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800' },
  UNDERSTANDING_OF_REQUIREMENTS: { cls: 'bg-fuchsia-50 dark:bg-fuchsia-950/50 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-200 dark:border-fuchsia-800' },
  TECHNICAL_PROPOSAL: { cls: 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800' },
  PROJECT_PLAN: { cls: 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800' },
  TEAM_QUALIFICATIONS: { cls: 'bg-lime-50 dark:bg-lime-950/50 text-lime-700 dark:text-lime-300 border-lime-200 dark:border-lime-800' },
  PAST_PERFORMANCE: { cls: 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800' },
  COST_PROPOSAL: { cls: 'bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800' },
  MANAGEMENT_APPROACH: { cls: 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800' },
  RISK_MANAGEMENT: { cls: 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800' },
  COMPLIANCE_MATRIX: { cls: 'bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800' },
  CERTIFICATIONS: { cls: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' },
  APPENDICES: { cls: 'bg-stone-50 dark:bg-stone-900/50 text-stone-700 dark:text-stone-300 border-stone-200 dark:border-stone-700' },
  // Supporting / Administrative
  EXECUTIVE_BRIEF: { cls: 'bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800' },
  MANAGEMENT_PROPOSAL: { cls: 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800' },
  PRICE_VOLUME: { cls: 'bg-green-50 dark:bg-green-950/50 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800' },
  QUALITY_MANAGEMENT: { cls: 'bg-cyan-50 dark:bg-cyan-950/50 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800' },
  TEAMING_AGREEMENT: { cls: 'bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800' },
  NDA: { cls: 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800' },
  CONTRACT: { cls: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800' },
  AMENDMENT: { cls: 'bg-yellow-50 dark:bg-yellow-950/50 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800' },
  CORRESPONDENCE: { cls: 'bg-slate-50 dark:bg-slate-900/50 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700' },
  CLARIFYING_QUESTIONS: { cls: 'bg-cyan-50 dark:bg-cyan-950/50 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800' },
  // Fallbacks
  PROPOSAL: { cls: 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800' },
  OTHER: { cls: 'bg-gray-50 dark:bg-gray-900/50 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700' },
} as const;

export function getDocumentTypeStyle(type: string): { cls: string } {
  return DOCUMENT_TYPE_STYLES[type] ?? DOCUMENT_TYPE_STYLES.OTHER;
}

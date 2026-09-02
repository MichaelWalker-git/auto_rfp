import type { ComplianceFinding } from '@auto-rfp/core';

/**
 * Turn a compliance finding into a pre-filled edit instruction for the inline
 * "Edit with AI" composer — the "fix it where you found it" UX. The finding
 * IS the edit instruction: we surface its title/snippet so the user confirms or
 * tweaks a self-contained instruction before sending.
 */
export const seedInstructionFromFinding = (finding: ComplianceFinding): string => {
  const snippet = finding.snippet?.trim();
  const where = finding.documentTitle ? ` in "${finding.documentTitle}"` : '';

  if (finding.issueType === 'INCONSISTENCY') {
    return (
      `The value below disagrees across the package${where}. ` +
      (snippet ? `The finding notes: "${snippet}". ` : '') +
      `Make it consistent everywhere it appears.`
    );
  }

  // Generic fallback: describe the issue and ask to fix it package-wide.
  return (
    `${finding.title}${where}. ` +
    (snippet ? `Relevant text: "${snippet}". ` : '') +
    `Update this everywhere it appears in the package.`
  );
};

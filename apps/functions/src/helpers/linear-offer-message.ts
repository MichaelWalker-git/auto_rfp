/**
 * Builds the Linear ticket body for an RFP opportunity as a preliminary-offer
 * hand-off note (HOR-2729). The ticket is intentionally NOT a full RFP
 * breakdown — it reads as a short message to the reviewer with two links:
 * the offer analysis (a Google Doc) and the supporting documents (the Drive
 * folder), plus a link back into AutoRFP.
 *
 * The links come into existence at different points in the flow:
 *   - `autoRfpUrl` is known when the ticket is first created.
 *   - `analysisUrl` (Google Doc) and `documentsUrl` (Drive folder) only exist
 *     after the Google Drive sync runs, which then updates the description.
 *
 * Only the lines whose links are present are rendered, so the same builder
 * produces a sensible body at every stage.
 */
export interface OfferMessageLinks {
  /** Google Doc containing the offer analysis (the executive brief). */
  analysisUrl?: string;
  /** Google Drive folder holding the offer documents. */
  documentsUrl?: string;
  /** Deep link back to the opportunity in AutoRFP. */
  autoRfpUrl?: string;
}

/** Recipient greeting — hardcoded per product decision (HOR-2729). */
const GREETING_NAME = 'Brennen';

export const buildOfferMessage = (links: OfferMessageLinks): string => {
  const lines: string[] = [
    `Hi ${GREETING_NAME},`,
    '',
    "I've prepared a preliminary offer for your review so we can continue moving forward.",
    'The first link contains the offer analysis, and the second includes the documents corresponding to the offer.',
    '',
  ];

  if (links.analysisUrl) {
    lines.push(`Analysis: ${links.analysisUrl}`, '');
  }
  if (links.documentsUrl) {
    lines.push(`Documents: ${links.documentsUrl}`, '');
  }
  if (links.autoRfpUrl) {
    lines.push(`AutoRFP: ${links.autoRfpUrl}`, '');
  }

  return lines.join('\n').trimEnd();
};

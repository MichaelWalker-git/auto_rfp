/**
 * Constants for the notary-detection engine (u1-notary-core-engine).
 *
 * The engine follows the same two-stage shape as the factual-accuracy checks:
 * cheap deterministic candidate generation (high recall) → one batched model
 * verification call (the precision gate). These bounds keep Stage 2 token-safe on
 * a pathological package and cap the candidate breadth.
 *
 * No model-id constant lives here — the model id is a caller-supplied argument
 * that inherits the stack default (pinned/EOL ids fail via the API key).
 */
import type { NotaryCue } from '@auto-rfp/core';

/**
 * Stage-1 hard cap on candidate spots fed into the single Stage-2 model call.
 * Mirrors `MAX_FACTUAL_CANDIDATES_PER_CHECK`. Overflow is never silently dropped:
 * the wrapper appends one POSSIBLY_REQUIRED "review manually — not fully scanned"
 * requirement so a truncated scan can never report a clean NOT_REQUIRED (BR5.1).
 */
export const MAX_NOTARY_CANDIDATES = 60;

/** Max output tokens for the batched Stage-2 verification call. */
export const MAX_TOKENS_NOTARY = 4000;

/** Chars of context kept on each side of a match when building triggeringText. */
export const SNIPPET_CONTEXT_WIDTH = 60;

/**
 * Tunable high-recall pattern table (BR1.1). Each entry maps a deterministic cue
 * to a case-insensitive regex. Over-flagging is intentional — Stage-2 is the
 * precision gate — so patterns favour recall over precision.
 *
 * Each regex is a NON-global template: the engine clones it with the `g` flag per
 * scan (`new RegExp(re.source, 'gi')`) so no mutable `lastIndex` state leaks
 * across calls (the same reason the compliance-review text helpers use factories).
 */
export const NOTARY_PATTERNS: ReadonlyArray<{ cue: NotaryCue; re: RegExp }> = [
  // Direct notary keyword family: notary / notarize(d) / notarization / notarial.
  { cue: 'KEYWORD', re: /notar(?:y|ies|ial|ize|izes|ized|ization|ise|ises|ised|isation)/i },

  // An explicit instruction that binds the form to notarization.
  {
    cue: 'INSTRUCTIONAL',
    re: /(?:must|shall|should|need(?:s|ed)?\s+to|has\s+to|is\s+to|to)\s+be\s+notari[sz]ed|notari[sz]ation\s+(?:is\s+)?required|requires?\s+notari[sz]ation|have\s+(?:this|the|it)\s+(?:form|document|page)?\s*notari[sz]ed/i,
  },

  // A real acknowledgment / jurat block: "personally appeared", "before me".
  {
    cue: 'ACK_BLOCK',
    re: /acknowledg(?:ed|ment|ement)\s+before\s+me|before\s+me[, ]+(?:the\s+undersigned\s+)?(?:a\s+)?notary|before\s+me\s+personally|personally\s+appeared|\bjurat\b/i,
  },

  // The jurisdiction header of a notarial certificate: "State of __ County of __".
  { cue: 'STATE_COUNTY', re: /\bstate\s+of\b[\s\S]{0,40}?\bcounty\s+of\b/i },

  // The notary commission clause.
  {
    cue: 'COMMISSION',
    re: /my\s+commission\s+expires|commission\s+(?:number|no\.?|expires|expiration)|notary\s+commission|commissioned\s+in|notary\s+(?:public|seal|stamp)/i,
  },

  // Sworn-statement / oath language (affidavit, jurat body).
  {
    cue: 'SWORN',
    re: /subscribed\s+and\s+sworn|sworn\s+(?:to\s+)?(?:and\s+subscribed|before\s+me)|being\s+duly\s+sworn|solemnly\s+swear|under\s+oath|deposes?\s+and\s+says|\baffiant\b|\baffidavit\b/i,
  },

  // Witness / seal-of-office language of a notarial certificate.
  {
    cue: 'WITNESS',
    re: /witness\s+my\s+hand\s+and\s+(?:official\s+|notarial\s+)?seal|in\s+witness\s+whereof|\bwitnesseth\b|(?:official|notarial)\s+seal|seal\s+of\s+office/i,
  },
];

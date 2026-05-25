/**
 * Shared helpers for QuestionFile statuses on the frontend.
 *
 * The pipeline stamps a series of statuses on each file. PROCESSED is the
 * canonical "extraction done" state, but downstream sub-states
 * (GENERATING_ANSWERS, ANSWERS_READY, FILLING_FORMS, FORMS_READY) are set
 * after extraction finishes, so callers that need "is this file extracted?"
 * (gating actions, hiding spinners, listing questions) must accept any of
 * them. Without this, a Textract-forms callback that races past PROCESSED
 * silently breaks anything keyed on a strict equality check.
 */
export const QUESTION_FILE_EXTRACTED_STATUSES: readonly string[] = [
  'PROCESSED',
  'GENERATING_ANSWERS',
  'ANSWERS_READY',
  'FILLING_FORMS',
  'FORMS_READY',
];

const EXTRACTED_SET = new Set<string>(QUESTION_FILE_EXTRACTED_STATUSES);

export const isExtractedQuestionFile = (status: string | undefined | null): boolean =>
  !!status && EXTRACTED_SET.has(status);

import { Context } from 'aws-lambda';
import { withSentryLambda } from '@/sentry-lambda';
import { updateQuestionFile } from '@/helpers/questionFile';
import { AI_NOT_CONFIGURED_CODE, AiNotConfiguredError } from '@/helpers/ai-config-error';

/**
 * Shared catch target for the question-extraction pipeline.
 *
 * Any processing stage that throws (Bedrock outage, AI-not-configured for the
 * org, malformed input, etc.) routes here via `.addCatch(...)` so the
 * QuestionFile is marked FAILED with a human-readable `errorMessage` instead of
 * being left stuck in an in-progress status (e.g. "Text ready"). Without this,
 * a downstream failure after the text-extraction step leaves the file
 * permanently mid-pipeline with no signal to the user.
 *
 * The Step Functions catcher passes the error under `$.error`, which carries
 * `Error` (the thrown error's name/type) and `Cause` (a JSON string of the
 * Lambda error payload — `{ errorMessage, errorType, trace }`).
 */
interface Event {
  projectId?: string;
  opportunityId?: string;
  questionFileId?: string;
  /** Step Functions `$.error.Error` — the error name/type. */
  errorName?: string;
  /** Step Functions `$.error.Cause` — a JSON string of the Lambda error payload. */
  errorCause?: string;
}

const MAX_ERROR_MESSAGE_LENGTH = 1000;

const FRIENDLY_AI_NOT_CONFIGURED_MESSAGE = new AiNotConfiguredError('').message;

const GENERIC_MESSAGE =
  'Processing failed while extracting this document. Please try again, or contact support if the problem persists.';

/**
 * Turn the Step Functions error envelope into a message safe to show a user.
 * Recognizes the AI-not-configured failure and renders the same guidance the
 * synchronous surfaces use; otherwise falls back to the underlying Lambda
 * error message, then a generic message.
 */
const deriveErrorMessage = (errorName?: string, errorCause?: string): string => {
  let causeMessage: string | undefined;
  let causeType: string | undefined;
  if (errorCause) {
    try {
      const parsed = JSON.parse(errorCause) as { errorMessage?: string; errorType?: string };
      causeMessage = parsed.errorMessage;
      causeType = parsed.errorType;
    } catch {
      // Cause was not JSON (e.g. a states-level failure) — treat it as the message.
      causeMessage = errorCause;
    }
  }

  const haystack = `${errorName ?? ''} ${causeType ?? ''} ${causeMessage ?? ''}`;
  const isAiNotConfigured =
    haystack.includes('AiNotConfiguredError') ||
    haystack.includes(AI_NOT_CONFIGURED_CODE) ||
    haystack.includes('AI is not configured');
  if (isAiNotConfigured) return FRIENDLY_AI_NOT_CONFIGURED_MESSAGE;

  const message = causeMessage || errorName || GENERIC_MESSAGE;
  return message.slice(0, MAX_ERROR_MESSAGE_LENGTH);
};

export const baseHandler = async (event: Event, _ctx: Context) => {
  const { questionFileId, projectId, opportunityId, errorName, errorCause } = event;
  if (!questionFileId || !projectId || !opportunityId)
    throw new Error('projectId, opportunityId and questionFileId are required');

  const errorMessage = deriveErrorMessage(errorName, errorCause);

  await updateQuestionFile(projectId, opportunityId, questionFileId, {
    status: 'FAILED',
    errorMessage,
  });
  return { questionFileId, projectId, oppId: opportunityId };
};

export const handler = withSentryLambda(baseHandler);

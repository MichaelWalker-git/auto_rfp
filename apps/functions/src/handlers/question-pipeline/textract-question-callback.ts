/**
 * Lambda handler for Textract SNS callback.
 * This handler is slim - it only parses the event and delegates to the helper.
 */
import { Context } from 'aws-lambda';
import { withSentryLambda } from '@/sentry-lambda';
import { processTextractCallback, TextractMessage } from '@/helpers/textract-callback';

export interface TextractCallbackEvent {
  Records: Array<{
    Sns: {
      Message: string;
    };
  }>;
}

export const baseHandler = async (
  event: TextractCallbackEvent,
  _ctx: Context,
): Promise<void> => {
  console.log('textract-question-callback event:', JSON.stringify(event));

  for (const record of event.Records) {
    const message: TextractMessage = JSON.parse(record.Sns.Message);
    console.log('Parsed Textract message:', record.Sns.Message);

    await processTextractCallback(message);
  }
};

export const handler = withSentryLambda(baseHandler);

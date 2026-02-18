import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { withSentryLambda } from '../../sentry-lambda';
import { makeEnqueueHandler } from '@/helpers/executive-brief-queue';

export const baseHandler =
  makeEnqueueHandler('risks') as (e: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;

export const handler = withSentryLambda(baseHandler);

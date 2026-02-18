import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { SimilarQuestion } from '@auto-rfp/shared';
import { withSentryLambda } from '../sentry-lambda';
import middy from '@middy/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';
import { getEmbedding } from '../helpers/embeddings';
import { getPineconeClient } from '../helpers/pinecone';
import { apiResponse, getOrgId } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_PK } from '../constants/question';
import { ANSWER_PK } from '../constants/answer';
import { QUESTION_EMBEDDING_TYPE, SIMILAR_THRESHOLD, MAX_SIMILAR_QUESTIONS } from '../constants/clustering';
import { getOrganizationById } from '../organization/get-organization-by-id';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const PINECONE_INDEX = requireEnv('PINECONE_INDEX');

interface QuestionDBItem {
  questionId: string;
  question: string;
  projectId?: string;
  sectionId?: string;
  sectionTitle?: string;
  clusterId?: string;
}

interface AnswerDBItem {
  questionId: string;
  text: string;
}


async function getQuestionById(projectId: string, questionId: string): Promise<QuestionDBItem | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_PK,
        [SK_NAME]: `${projectId}#${questionId}`,
      },
    })
  );
  return result.Item as QuestionDBItem | null;
}

async function getAnswerForQuestion(projectId: string, questionId: string): Promise<AnswerDBItem | null> {
  const result = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: ANSWER_PK,
        [SK_NAME]: `${projectId}#${questionId}`,
      },
    })
  );
  return result.Item as AnswerDBItem | null;
}

/**
 * Find similar questions using Pinecone semantic search
 */
async function findSimilarInPinecone(
  orgId: string,
  projectId: string,
  questionText: string,
  excludeQuestionId: string,
  threshold: number,
  limit: number
): Promise<Array<{ questionId: string; similarity: number; questionText?: string; sectionId?: string; sectionTitle?: string }>> {
  const client = getPineconeClient();
  const index = client.Index(PINECONE_INDEX);
  
  const embedding = await getEmbedding(questionText);
  
  const results = await index.namespace(orgId).query({
    vector: embedding,
    topK: limit + 5, 
    includeMetadata: true,
    filter: {
      type: { $eq: QUESTION_EMBEDDING_TYPE },
      projectId: { $eq: projectId },
    },
  });
    
  const similar: Array<{ questionId: string; similarity: number; questionText?: string; sectionId?: string; sectionTitle?: string }> = [];
  
  for (const match of results.matches || []) {
    const matchedQuestionId = match.metadata?.questionId as string | undefined;
    const score = match.score ?? 0;
      
    // Skip self (by questionId) and below threshold
    if (!matchedQuestionId) {
      console.log(`    -> SKIP: no questionId in metadata`);
      continue;
    }
    if (matchedQuestionId === excludeQuestionId) {
      console.log(`    -> SKIP: same questionId as source (${excludeQuestionId})`);
      continue;
    }
    if (score < threshold) {
      console.log(`    -> SKIP: below threshold ${threshold}`);
      continue;
    }
    
    similar.push({
      questionId: matchedQuestionId,
      similarity: score,
      questionText: match.metadata?.questionText as string | undefined,
      sectionId: match.metadata?.sectionId as string | undefined,
      sectionTitle: match.metadata?.sectionTitle as string | undefined,
    });
    
    if (similar.length >= limit) break;
  }
  
  console.log(`Returning ${similar.length} similar questions after filtering`);
  
  return similar;
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { projectId, questionId } = event.pathParameters || {};
    
    if (!projectId || !questionId) {
      return apiResponse(400, { message: 'Missing projectId or questionId' });
    }
    
    // Get threshold and limit from query params (with defaults)
    const {
      threshold: thresholdParam,
      limit: limitParam,
    } = event.queryStringParameters ?? {};
    
    const threshold = thresholdParam
      ? Math.max(0, Math.min(1, Number(thresholdParam)))
      : SIMILAR_THRESHOLD;
    
    const limit = limitParam
      ? Math.max(1, Math.min(50, Number(limitParam)))
      : MAX_SIMILAR_QUESTIONS;
    
    // Get the source question
    const question = await getQuestionById(projectId, questionId);
    
    if (!question || !question.question) {
      return apiResponse(404, { message: 'Question not found' });
    }
    
    // Get orgId from token/query params
    const orgId = getOrgId(event);
    
    if (!orgId) {
      return apiResponse(400, { message: 'Organization ID is required (pass via orgId query param or token)' });
    }
    
    // Get org settings for threshold (if not explicitly passed)
    let effectiveThreshold = threshold;
    if (!thresholdParam) {
      try {
        const org = await getOrganizationById(orgId);
        if (org?.similarThreshold != null && typeof org.similarThreshold === 'number') {
          effectiveThreshold = org.similarThreshold;
          console.log(`Using org similarThreshold: ${(effectiveThreshold * 100).toFixed(0)}%`);
        }
      } catch (err) {
        console.warn('Failed to load org settings, using default threshold:', err);
      }
    }
    
    // Find similar questions in Pinecone
    const similarMatches = await findSimilarInPinecone(
      orgId,
      projectId,
      question.question,
      questionId,
      effectiveThreshold,
      limit
    );
    
    // Enrich with answer status and full question data
    const enrichedResults = await Promise.all(
      similarMatches.map(async (match) => {
        // Get full question details from DB (in case Pinecone metadata is stale)
        const fullQuestion = await getQuestionById(projectId, match.questionId);
        
        // If question doesn't exist in DB, it's a stale Pinecone vector - skip it
        if (!fullQuestion) {
          console.log(`  Skipping stale Pinecone vector: ${match.questionId} (not in DynamoDB)`);
          return null;
        }
        
        const answer = await getAnswerForQuestion(projectId, match.questionId);
        
        const hasAnswer = !!answer?.text;
        const answerPreview = hasAnswer
          ? answer!.text.substring(0, 150) + (answer!.text.length > 150 ? '...' : '')
          : undefined;
        
        return {
          questionId: match.questionId,
          questionText: fullQuestion.question || match.questionText || '',
          sectionId: fullQuestion.sectionId || match.sectionId,
          sectionTitle: fullQuestion.sectionTitle || match.sectionTitle,
          similarity: match.similarity,
          hasAnswer,
          answerPreview,
          inSameCluster: !!(fullQuestion.clusterId && fullQuestion.clusterId === question.clusterId),
          clusterId: fullQuestion.clusterId,
        };
      })
    );
    
    // Filter out null results (stale vectors) and sort by similarity descending
    const similarQuestions = enrichedResults
      .filter((sq) => sq !== null)
      .sort((a, b) => (b?.similarity ?? 0) - (a?.similarity ?? 0)) as SimilarQuestion[];
    
    return apiResponse(200, {
      questionId,
      questionText: question.question,
      similarQuestions,
      threshold,
      limit,
    });
  } catch (err) {
    console.error('find-similar-questions error:', err);
    return apiResponse(500, {
      message: 'Failed to find similar questions',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:read'))
    .use(httpErrorMiddleware())
);
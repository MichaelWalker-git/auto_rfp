import { Context } from 'aws-lambda';
import { PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { QUESTION_PK } from '../constants/question';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { safeParseJsonFromModel } from '../helpers/json';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import { loadTextFromS3 } from '../helpers/executive-opportunity-frief';
import { docClient } from '../helpers/db';

const BEDROCK_REGION = requireEnv('BEDROCK_REGION');
const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');
const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const bedrockClient = new BedrockRuntimeClient({
  region: BEDROCK_REGION,
});

interface Event {
  questionFileId?: string;
  projectId?: string;
  textFileKey?: string;
}

type ExtractedQuestions = {
  sections: Array<{
    id: string;
    title: string;
    description?: string | null;
    questions: Array<{
      id: string;
      question: string;
    }>;
  }>;
};

export const baseHandler = async (
  event: Event,
  _ctx: Context,
): Promise<{ count: number }> => {
  console.log('extract-questions event:', JSON.stringify(event));

  const { questionFileId, projectId, textFileKey } = event;
  if (!questionFileId || !projectId || !textFileKey) {
    throw new Error('questionFileId, projectId, textFileKey are required');
  }

  // 1) Load text from S3
  const text = await loadTextFromS3(DOCUMENTS_BUCKET, textFileKey);

  // 2) Call Bedrock with the same prompt/structure as in the HTTP Lambda
  const extracted = await extractQuestionsWithBedrock(text);

  // 3) Save questions (section + questions) in DynamoDB (linked to this file)
  const totalQuestions = await saveQuestionsFromSections(
    questionFileId,
    projectId,
    extracted,
  );

  // 4) Update status on question_file item
  await updateStatus(questionFileId, projectId, 'questions_extracted', totalQuestions);

  return { count: totalQuestions };
};

async function extractQuestionsWithBedrock(
  content: string,
): Promise<ExtractedQuestions> {
  const systemPrompt = getSystemPrompt();
  const userPrompt = buildUserPrompt(content);

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: userPrompt,
      },
    ],
    max_tokens: 16384,
    temperature: 0.1,
  };

  const res = await bedrockClient.send(
    new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(JSON.stringify(body)),
    }),
  );

  if (!res.body) {
    throw new Error('Bedrock returned empty body for question extraction');
  }

  const jsonTxt = new TextDecoder('utf-8').decode(res.body);

  let outer: any;
  try {
    outer = JSON.parse(jsonTxt);
  } catch {
    console.error('Bad response JSON from Bedrock:', jsonTxt);
    throw new Error('Invalid JSON envelope from Bedrock');
  }

  console.log('Bedrock envelope:', JSON.stringify(outer).slice(0, 2000));

  const stopReason = outer.stop_reason || outer.stopReason;
  const usage = outer.usage;

  console.log('stop_reason:', stopReason, 'usage:', usage);

  const assistantText = outer?.content?.[0]?.text;
  if (!assistantText) {
    throw new Error('Model returned no text content');
  }

  const parsed = safeParseJsonFromModel(assistantText);

  if (!Array.isArray(parsed.sections)) {
    throw new Error('Response missing required sections[]');
  }

  return parsed as ExtractedQuestions;
}

async function saveQuestionsFromSections(
  questionFileId: string,
  projectId: string,
  extracted: ExtractedQuestions,
): Promise<number> {
  const now = new Date().toISOString();
  let count = 0;

  const writes: Promise<any>[] = [];

  for (const section of extracted.sections) {
    for (const q of section.questions) {
      const sortKey = `${projectId}#${q.id}`;

      const item = {
        [PK_NAME]: QUESTION_PK,
        [SK_NAME]: sortKey,
        projectId,
        questionFileId,
        questionId: q.id,
        question: q.question,
        sectionId: section.id,
        sectionTitle: section.title,
        sectionDescription: section.description ?? null,
        createdAt: now,
        updatedAt: now,
      };

      writes.push(
        docClient.send(
          new PutCommand({
            TableName: DB_TABLE_NAME,
            Item: item,
          }),
        ),
      );

      count++;
    }
  }

  await Promise.all(writes);
  return count;
}

async function updateStatus(
  questionFileId: string,
  projectId: string,
  status: 'processing' | 'text_ready' | 'questions_extracted' | 'error',
  questionCount?: number,
) {
  const sk = `${projectId}#${questionFileId}`;

  const updateParts: string[] = ['#status = :status', '#updatedAt = :updatedAt'];
  const exprAttrNames: Record<string, string> = {
    '#status': 'status',
    '#updatedAt': 'updatedAt',
  };
  const exprAttrValues: Record<string, any> = {
    ':status': status,
    ':updatedAt': new Date().toISOString(),
  };

  if (typeof questionCount === 'number') {
    updateParts.push('#questionCount = :questionCount');
    exprAttrNames['#questionCount'] = 'questionCount';
    exprAttrValues[':questionCount'] = questionCount;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk,
      },
      UpdateExpression: `SET ${updateParts.join(', ')}`,
      ExpressionAttributeNames: exprAttrNames,
      ExpressionAttributeValues: exprAttrValues,
    }),
  );
}

const getSystemPrompt = () => {
  const timestamp = Date.now();
  return `
You are an expert at analyzing RFP (Request for Proposal) documents and extracting structured information.
Given a document that contains RFP questions, extract all sections and questions into a structured format.

Carefully identify:
1. Different sections (usually numbered like 1.1, 1.2, etc.)
2. The questions within each section or empty array
3. Any descriptive text that provides context for the section

Format the output as a JSON object with the following structure:
{
  "sections": [
    {
      "id": "section_${timestamp}_1",
      "title": "Section Title",
      "description": "Optional description text for the section",
      "questions": [
        {
          "id": "q_${timestamp}_1_1",
          "question": "The exact text of the question"
        }
      ]
    }
  ]
}

Requirements:
- Generate unique reference IDs using the format: q_${timestamp}_<section>_<question> for questions
- Generate unique reference IDs using the format: section_${timestamp}_<number> for sections  
- Preserve the exact text of questions
- Include all questions found in the document
- Group questions correctly under their sections
- If a section has subsections, create separate sections for each subsection
- The timestamp prefix (${timestamp}) ensures uniqueness across different document uploads
    `.trim();
};

const buildUserPrompt = (content: string) => {
  return `Document Content:\n${content}`;
};

export const handler = withSentryLambda(baseHandler);
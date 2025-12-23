import { Context } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

import { PROJECT_PK } from '../constants/organization';
import { QUESTION_PK } from '../constants/question';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { safeParseJsonFromModel } from '../helpers/json';
import { withSentryLambda } from '../sentry-lambda';
import { getProjectById } from '../helpers/project';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const s3Client = new S3Client({});

const BEDROCK_REGION =
  process.env.BEDROCK_REGION ||
  process.env.AWS_REGION ||
  'us-east-1';
const BEDROCK_MODEL_ID =
  process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-haiku-20240307-v1:0';

const bedrockClient = new BedrockRuntimeClient({
  region: BEDROCK_REGION,
});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
const DOCUMENTS_BUCKET_NAME = process.env.DOCUMENTS_BUCKET_NAME;

if (!DB_TABLE_NAME) throw new Error('DB_TABLE_NAME env var is not set');
if (!DOCUMENTS_BUCKET_NAME)
  throw new Error('DOCUMENTS_BUCKET_NAME env var is not set');

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
  const text = await loadTextFromS3(textFileKey);

  // 2) Call Bedrock with the same prompt/structure as in the HTTP Lambda
  const extracted = await extractQuestionsWithBedrock(text);

  const summary = await generateSummary(text);

  const eligibility = await extractEligibility(text);

  // 3) Save questions (section + questions) in DynamoDB (linked to this file)
  const totalQuestions = await saveQuestionsFromSections(
    questionFileId,
    projectId,
    extracted,
  );

  // 4) Update status on question_file item
  await updateStatus(questionFileId, projectId, 'questions_extracted', totalQuestions);

  // 5) Update project to store summary and eligibility
  await updateProject(projectId, summary, eligibility);

  return { count: totalQuestions };
};

async function loadTextFromS3(key: string): Promise<string> {
  const res = await s3Client.send(
    new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET_NAME,
      Key: key,
    }),
  );

  const body = await res.Body?.transformToString();
  if (!body) {
    throw new Error(`Failed to read text file from S3: ${key}`);
  }
  return body;
}

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
        questionText: q.question,
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


const getSummarySystemPrompt = () => {
  return `
You are an expert at analyzing RFP (Request for Proposal) documents and creating concise, informative summaries.

Your task is to read through the RFP document and create a comprehensive paragraph summary that captures:
1. The purpose and scope of the project/procurement
2. Key requirements and deliverables
3. Important dates, deadlines, or timelines mentioned
4. Any special qualifications or criteria for vendors
5. The overall scale or nature of the work

Write a clear, professional summary in paragraph form (3-5 sentences) that would help someone quickly understand what this RFP is about and what the organization is seeking. Focus on the most important aspects that potential bidders would need to know.

Do not include section numbers, question lists, or administrative details like submission instructions. Focus on the substance of what is being procured.
    `.trim();
};

const getEligibilitySystemPrompt = () => {
  return `
You are an expert at analyzing RFP (Request for Proposal) documents and extracting vendor eligibility requirements.

Your task is to read through the RFP document and identify all key eligibility criteria that vendors must meet to qualify for this proposal. Focus on extracting:

1. Minimum experience requirements (years in business, project experience)
2. Technical qualifications and certifications
3. Financial requirements (bonding, insurance, revenue thresholds)
4. Geographic restrictions or preferences
5. Industry-specific licenses or accreditations
6. Staff qualifications and expertise requirements
7. Past performance criteria
8. Legal and compliance requirements
9. Size classifications (small business, minority-owned, etc.)
10. Any other mandatory qualifications mentioned

Format your response as a JSON object with an "eligibility" array containing clear, concise bullet points. Each requirement should be a standalone statement that a vendor can easily evaluate against their own qualifications.

Example format:
{
  "eligibility": [
    "Minimum 5 years of experience in software development",
    "Must hold current ISO 27001 certification",
    "Annual revenue of at least $10 million",
    "Licensed to operate in the State of California"
  ]
}

Focus only on mandatory requirements, not preferences. If no clear eligibility criteria are found, return an empty array.
    `.trim();
};

const generateSummary = async (content: string) => {
  try {
    const systemPrompt = getSummarySystemPrompt();
    const userPrompt = buildUserPrompt(content);

    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      system: [{ type: 'text', text: systemPrompt }],
      messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
      temperature: 0.3,        // Slightly higher for more creative summaries
      max_tokens: 500,         // Limit summary length
    });

    const command = new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(body),
    });

    const response = await bedrockClient.send(command);

    const raw = new TextDecoder().decode(response.body);
    const outer = JSON.parse(raw);

    // Claude-style Bedrock response:
    // { content: [{ text: "..." }], ... }
    const textChunk: string | undefined =
      outer?.content?.[0]?.text ??
      outer?.output_text ??
      outer?.completion;

    if (!textChunk) {
      console.error('Invalid textChunk', textChunk);
      return '';
    }

    return textChunk.trim();
  } catch (error) {
    console.error(error);
    return '';
  }
};

function buildUserPrompt(content: string): string {
  return `Document Content:\n${content}`;
}

export const extractEligibility = async (
  content: string,
): Promise<string[]> => {
  try {
    const systemPrompt = getEligibilitySystemPrompt();
    const userPrompt = buildUserPrompt(content);

    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      system: [{ type: 'text', text: systemPrompt }],
      messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
      temperature: 0.1,   // Low temperature for precise extraction
      max_tokens: 1000,   // Allow for comprehensive eligibility lists
      response_format: {
        type: 'json',
      },
    });

    const command = new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(body),
    });

    const response = await bedrockClient.send(command);

    const raw = new TextDecoder().decode(response.body);
    const outer = JSON.parse(raw);

    const assistantMessage: string | undefined =
      outer?.content?.[0]?.text ??
      outer?.output_text ??
      outer?.completion;

    if (!assistantMessage) {
      console.error('Empty assistant message', assistantMessage);
      return Promise.resolve([]);
    }

    const rawData = JSON.parse(assistantMessage);

    if (!rawData.eligibility || !Array.isArray(rawData.eligibility)) {
      console.error('Bad response', rawData);
      return Promise.resolve([]);
    }

    return rawData.eligibility.filter((item: unknown) => typeof item === 'string' && item.trim().length > 0);
  } catch (error) {
    console.error(error);
    return Promise.resolve([]);
  }
};

export const updateProject = async (
  projectId: string,
  summary: string,
  eligibility: string[],
): Promise<void> => {
  const {
    sort_key
  } = await getProjectById(docClient, DB_TABLE_NAME, projectId);
  const now = new Date().toISOString();

  const cmd = new UpdateCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: PROJECT_PK,
      [SK_NAME]: sort_key,
    },
    UpdateExpression: 'SET #summary = :summary, #eligibility = :eligibility, #updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#summary': 'summary',
      '#eligibility': 'eligibility',
      '#updatedAt': 'updatedAt',
      '#pk': PK_NAME,
      '#sk': SK_NAME,
    },
    ExpressionAttributeValues: {
      ':summary': summary,
      ':eligibility': eligibility,
      ':updatedAt': now,
    },
    ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
    ReturnValues: 'NONE',
  });

  await docClient.send(cmd);
};

export const handler = withSentryLambda(baseHandler);
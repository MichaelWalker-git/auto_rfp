import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client, } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand, } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';

import { PK_NAME, SK_NAME } from '../constants/common';
import { DOCUMENT_PK } from '../constants/document';
import { QUESTION_PK } from '../constants/organization';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { GenerateProposalRequest, ProposalDocument, ProposalDocumentSchema, } from '../schemas/proposal';
import { getProjectById } from '../helpers/project';
import { KNOWLEDGE_BASE_PK } from '../constants/organization';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const s3Client = new S3Client({});
const bedrockClient = new BedrockRuntimeClient({});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME!;
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET!;
const BEDROCK_MODEL_ID =
  process.env.BEDROCK_MODEL_ID ||
  'anthropic.claude-3-5-sonnet-20241022-v2:0';
const BEDROCK_REGION =
  process.env.BEDROCK_REGION ||
  process.env.AWS_REGION ||
  'us-east-1';

(bedrockClient as any).config.region = BEDROCK_REGION;

// ====== Input schema ======
const GenerateProposalInputSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
});

type GenerateProposalInput = z.infer<typeof GenerateProposalInputSchema>;

// Convenience types from your proposal schema
type QaPair = GenerateProposalRequest['qaPairs'][number];
type KnowledgeBaseSnippet = NonNullable<
  GenerateProposalRequest['knowledgeBaseSnippets']
>[number];
type ProposalMetadata = GenerateProposalRequest['proposalMetadata'];

// ====== Helpers ======

const extractOrgIdFromSortKey = (sortKey: string): string => {
  const [orgId] = sortKey.split('#');
  return orgId;
};

const getObjectBodyAsString = async (
  bucket: string,
  key: string,
): Promise<string> => {
  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const res = await s3Client.send(cmd);

  if (!res.Body) return '';

  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as any as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
};

const loadKnowledgeBasesForOrg = async (
  orgId: string,
): Promise<any[]> => {
  // KB PK/SK from you:
  // PK = KNOWLEDGE_BASE_PK
  // SK = `${orgId}#${kbId}`

  const skPrefix = `${orgId}#`;

  const cmd = new QueryCommand({
    TableName: DB_TABLE_NAME,
    KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
    ExpressionAttributeNames: {
      '#pk': PK_NAME,
      '#sk': SK_NAME,
    },
    ExpressionAttributeValues: {
      ':pk': KNOWLEDGE_BASE_PK,
      ':skPrefix': skPrefix,
    },
  });

  const { Items } = await docClient.send(cmd);
  // TODO (optional): if KBs are also scoped by projectId via attribute, filter here.
  return Items ?? [];
};

const loadDocumentsForKnowledgeBase = async (
  knowledgeBaseId: string,
): Promise<any[]> => {
  // From you:
  // PK = DOCUMENT_PK
  // SK = `KB#${knowledgeBaseId}#DOC#${docId}`

  const skPrefix = `KB#${knowledgeBaseId}#DOC#`;

  const cmd = new QueryCommand({
    TableName: DB_TABLE_NAME,
    KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
    ExpressionAttributeNames: {
      '#pk': PK_NAME,
      '#sk': SK_NAME,
    },
    ExpressionAttributeValues: {
      ':pk': DOCUMENT_PK,
      ':skPrefix': skPrefix,
    },
  });

  const { Items } = await docClient.send(cmd);
  return Items ?? [];
};

const loadQaPairsForProject = async (
  projectId: string,
): Promise<QaPair[]> => {

  const skPrefix = `${projectId}#`;

  const cmd = new QueryCommand({
    TableName: DB_TABLE_NAME,
    KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
    ExpressionAttributeNames: {
      '#pk': PK_NAME,
      '#sk': SK_NAME,
    },
    ExpressionAttributeValues: {
      ':pk': QUESTION_PK,
      ':skPrefix': skPrefix,
    },
  });

  const { Items } = await docClient.send(cmd);
  if (!Items || Items.length === 0) return [];

  // NOTE: your question item uses "questionText" field name
  return Items.map((item) => ({
    questionId: item.questionId,
    question: item.questionText,
    // TODO: wire real answers when you have them
    answer: item.answer ?? '',
  })) as QaPair[];
};

const buildProposalMetadataFromProject = (project: any): ProposalMetadata => {
  // You said you only care about: summary, eligibility
  // but for proposal metadata we still need some basic fields.
  // Adjust mapping to your actual project attributes.
  return {
    opportunityId: undefined,
    rfpTitle: project.name ?? undefined,
    customerName: undefined,
    agencyName: undefined,
    dueDate: undefined,
    contractType: undefined,
    naicsCode: undefined,
    notes: project.summary ?? project.description ?? undefined,
  };
};

const buildKnowledgeBaseSnippets = async (
  documents: any[],
): Promise<KnowledgeBaseSnippet[]> => {
  const snippets: KnowledgeBaseSnippet[] = [];

  for (const doc of documents) {
    if (!doc.textFileKey) continue;

    const content = await getObjectBodyAsString(
      DOCUMENTS_BUCKET,
      doc.textFileKey,
    );

    if (!content.trim()) continue;

    snippets.push({
      id: doc.id,
      type: 'OTHER',
      title: doc.name,
      content,
      sourceDocumentName: doc.name,
    });
  }

  return snippets;
};

// ====== Prompts for proposal generation ======
const buildSystemPrompt = (): string =>
  `
You are a proposal writer for US government and commercial RFPs.

Your job:
- Take RFP metadata, Q&A, and knowledge-base snippets (past performance, capability statement, etc.)
- Create a clear outline specific to this proposal
- Then fully write each section and subsection in professional proposal language.

You MUST return ONLY valid JSON following this TypeScript-like structure:

{
  "proposalTitle": string,
  "customerName"?: string,
  "opportunityId"?: string,
  "outlineSummary"?: string,
  "sections": [
    {
      "id": string,
      "title": string,
      "summary"?: string,
      "subsections": [
        {
          "id": string,
          "title": string,
          "content": string
        }
      ]
    }
  ]
}

Rules:
- Use information from Q&A and knowledge base snippets wherever relevant.
- If something is unknown, make reasonable generic assumptions but DO NOT invent specific numbers, dates, or contract identifiers.
- Write in a clear, concise, persuasive tone.
- Do NOT include any explanation outside the JSON.
`.trim();

const buildUserPromptForProposal = (
  payload: GenerateProposalRequest,
): string => {
  const { proposalMetadata, qaPairs, knowledgeBaseSnippets } = payload;

  const metaLines: string[] = [];
  Object.entries(proposalMetadata).forEach(([key, value]) => {
    if (value) metaLines.push(`${key}: ${value}`);
  });

  const qaText =
    qaPairs.length > 0
      ? qaPairs
        .map(
          (qa, idx) =>
            `Q${idx + 1}: ${qa.question}\nA${idx + 1}: ${qa.answer}`,
        )
        .join('\n\n')
      : 'None';

  const kbText =
    (knowledgeBaseSnippets ?? []).length > 0
      ? (knowledgeBaseSnippets ?? [])
        .map((s, idx) => {
          const headerParts = [
            s.type ? `[${s.type}]` : '',
            s.title ?? `Snippet ${idx + 1}`,
            s.sourceDocumentName ? `(source: ${s.sourceDocumentName})` : '',
          ].filter(Boolean);
          return `${headerParts.join(' ')}\n${s.content}`;
        })
        .join('\n\n---\n\n')
      : 'None';

  return `
RFP / Proposal Metadata:
${metaLines.join('\n') || 'None'}

Q&A (from question extraction and internal review):
${qaText}

Knowledge Base Snippets (past performance, capability statement, resumes, etc.):
${kbText}

Task:
1. Design an outline specifically tailored to this opportunity and customer.
2. Write all sections and subsections as full proposal text using the given information.
3. Return ONLY JSON in the format defined by the system prompt.
  `.trim();
};

// ====== Lambda handler ======

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is required' });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(event.body);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    const inputResult = GenerateProposalInputSchema.safeParse(parsed);
    if (!inputResult.success) {
      return apiResponse(400, {
        message: 'Validation error',
        errors: inputResult.error.format(),
      });
    }

    const { projectId } = inputResult.data;

    // 1. Read project from DB
    // You already have this helper in your codebase and use it in updateProject
    const projectItem = await getProjectById(docClient, DB_TABLE_NAME, projectId);
    if (!projectItem) {
      return apiResponse(404, { message: 'Project not found' });
    }

    const { sort_key, ...project } = projectItem;
    const orgId = extractOrgIdFromSortKey(sort_key);

    // 2. Read knowledgebases related to org (and optionally filter by project if needed)
    const knowledgeBases = await loadKnowledgeBasesForOrg(orgId);
    // TODO: if KB is tied to specific project via attribute (e.g. projectId), filter here:
    // const knowledgeBases = allKbItems.filter(kb => kb.projectId === projectId);

    // 3. Read documents for each knowledge base
    const allDocuments: any[] = [];
    for (const kb of knowledgeBases) {
      const kbId = kb.id ?? kb.knowledgeBaseId;
      if (!kbId) continue;

      const docs = await loadDocumentsForKnowledgeBase(kbId);
      allDocuments.push(...docs);
    }

    // 4. Load S3 text content for documents → KB snippets
    const knowledgeBaseSnippets = await buildKnowledgeBaseSnippets(
      allDocuments,
    );

    // 5. Load questions (and answers if available) for project
    const qaPairs = await loadQaPairsForProject(projectId);

    if (qaPairs.length === 0) {
      return apiResponse(400, {
        message:
          'No questions found for this project. Cannot generate proposal without at least one QA pair.',
      });
    }

    // 6. Build proposal metadata from project
    const proposalMetadata = buildProposalMetadataFromProject(project);

    // 7. Build request payload for LLM
    const llmRequest: GenerateProposalRequest = {
      projectId,
      proposalMetadata,
      qaPairs,
      knowledgeBaseSnippets,
      requestedSections: undefined,
    };

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPromptForProposal(llmRequest);

    const body = JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      system: [{ type: 'text', text: systemPrompt }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: userPrompt }] },
      ],
      max_tokens: Number(process.env.BEDROCK_MAX_TOKENS ?? 4000),
      temperature: Number(process.env.BEDROCK_TEMPERATURE ?? 0.1),
    });


    const command = new InvokeModelCommand({
      modelId: BEDROCK_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: new TextEncoder().encode(body),
    });

    const response = await bedrockClient.send(command);

    const responseBodyString = new TextDecoder().decode(response.body);
    const outer = JSON.parse(responseBodyString);

    const textChunk: string | undefined =
      outer?.content?.[0]?.text ??
      outer?.output_text ??
      outer?.completion ??
      '';

    if (!textChunk) {
      console.error('Empty Bedrock response', outer);
      return apiResponse(502, {
        message: 'Empty response from Bedrock for proposal generation',
      });
    }

    let rawModelJson: unknown;
    try {
      rawModelJson = JSON.parse(textChunk);
    } catch {
      rawModelJson = outer;
    }

    const proposalResult = ProposalDocumentSchema.safeParse(rawModelJson);
    if (!proposalResult.success) {
      console.error('Proposal validation failed', proposalResult.error);
      return apiResponse(502, {
        message: 'Model did not return a valid proposal document',
        issues: proposalResult.error.format(),
        raw: rawModelJson,
      });
    }

    const proposal: ProposalDocument = proposalResult.data;

    return apiResponse(200, proposal);
  } catch (err: any) {
    console.error('Error in generate-proposal handler:', err);
    return apiResponse(500, {
      message: 'Internal server error during proposal generation',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);

import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

import crypto from 'crypto';
import { z } from 'zod';
import { PK_NAME, SK_NAME } from '../constants/common';
import { PROJECT_PK } from '../constants/organization';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { getProjectById } from '../helpers/project';

// ---------------------------
// Clients / config
// ---------------------------
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const s3Client = new S3Client({});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
const DOCUMENTS_BUCKET_NAME =
  process.env.DOCUMENTS_BUCKET_NAME ||
  process.env.DOCUMENTS_BUCKET ||
  process.env.DOCUMENTS_BUCKET_NAME;

if (!DB_TABLE_NAME) throw new Error('DB_TABLE_NAME env var is not set');
if (!DOCUMENTS_BUCKET_NAME) throw new Error('DOCUMENTS_BUCKET_NAME env var is not set');

const REGION =
  process.env.REGION ||
  process.env.AWS_REGION ||
  process.env.BEDROCK_REGION ||
  'us-east-1';

const MODEL_ID =
  process.env.BEDROCK_MODEL_ID ||
  'anthropic.claude-3-5-sonnet-20241022-v2:0';

const MAX_TOKENS = Number(process.env.BEDROCK_MAX_TOKENS ?? 6000);
const TEMPERATURE = Number(process.env.BEDROCK_TEMPERATURE ?? 0.2);

const bedrock = new BedrockRuntimeClient({ region: REGION });

// ---------------------------
// Request schema
// ---------------------------
const GenerateExecutiveBriefSchema = z.object({
  projectId: z.string().min(1, 'projectId is required'),
});
type DTO = z.infer<typeof GenerateExecutiveBriefSchema>;

// ---------------------------
// Types
// ---------------------------

type GoNoGo = 'GO' | 'NO_GO' | 'NEEDS_REVIEW';

type ScoreCriterion = {
  score?: number;
  confidence?: number;
  rationale?: string;
  evidence?: string[];
};

type BriefPayload = {
  quickSummary?: any;
  scoring?: {
    criteria?: {
      technicalFit?: ScoreCriterion;
      pastPerformanceRelevance?: ScoreCriterion;
      pricingPosition?: ScoreCriterion;
      strategicAlignment?: ScoreCriterion;
      incumbentRisk?: ScoreCriterion;
      [k: string]: any;
    };
    composite?: {
      total?: number;
      normalized?: number;
      confidence?: number;
      rationale?: string;
      recommendation?: GoNoGo;
      [k: string]: any;
    };
    [k: string]: any;
  };
  deadlines?: any;
  requirementsSummary?: any;
  contacts?: any;
  riskAssessment?: any;
  submissionCompliance?: any;
  pastPerformanceSignals?: any;
  finalRecommendation?: {
    recommendation?: GoNoGo;
    confidence?: number;
    topReasons?: string[];
    nextSteps?: string[];
    [k: string]: any;
  };
  [k: string]: any;
};

type QuestionFileStatus =
  | 'processing'
  | 'text_ready'
  | 'questions_extracted'
  | 'error';

interface QuestionFileItem {
  id?: string;
  projectId?: string;
  fileKey?: string;
  textFileKey?: string;
  status?: QuestionFileStatus;
  createdAt?: string;
  updatedAt?: string;
  [k: string]: any;
}

// ---------------------------
// Helpers
// ---------------------------
function stableHash(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

function clamp01(n: number) {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function safeParseJsonFromModel(text: string): any {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Model did not return a JSON object.');
  }
  return JSON.parse(text.slice(start, end + 1));
}

function safeCriterion(input: any): Required<Pick<ScoreCriterion, 'score' | 'confidence'>> {
  const rawScore = Number(input?.score);
  const score = Number.isFinite(rawScore)
    ? Math.min(5, Math.max(1, Math.round(rawScore)))
    : 1; // default low

  const rawConf = Number(input?.confidence);
  const confidence = Number.isFinite(rawConf)
    ? Math.min(1, Math.max(0, rawConf))
    : 0.0; // default low

  return { score, confidence };
}

function computeComposite(criteria: any) {
  const tf = safeCriterion(criteria?.technicalFit);
  const pp = safeCriterion(criteria?.pastPerformanceRelevance);
  const pr = safeCriterion(criteria?.pricingPosition);
  const sa = safeCriterion(criteria?.strategicAlignment);
  const ir = safeCriterion(criteria?.incumbentRisk);

  const scores = [tf.score, pp.score, pr.score, sa.score, ir.score];
  const total = scores.reduce((a, b) => a + b, 0); // 5..25
  const normalized = Math.round(((total - 5) / 20) * 100); // 0..100

  const confidence = Number(
    ((tf.confidence + pp.confidence + pr.confidence + sa.confidence + ir.confidence) / 5).toFixed(2),
  );

  const recommendation: GoNoGo =
    normalized >= 70 ? 'GO' : normalized <= 40 ? 'NO_GO' : 'NEEDS_REVIEW';

  return { total, normalized, confidence, recommendation };
}

function truncateSolicitationText(text: string, maxChars: number = 120000): string {
  if (text.length <= maxChars) return text;

  // Prioritize: intro -> middle -> end
  const intro = text.slice(0, 5000);
  const end = text.slice(-5000);
  const middleLength = maxChars - intro.length - end.length - 100;
  const middle = text.slice(5000, 5000 + middleLength);

  return `${intro}\n\n[... truncated ${text.length - maxChars} characters for token limits ...]\n\n${middle}\n\n[... end of document ...]\n\n${end}`;
}

async function loadTextFromS3(key: string): Promise<string> {
  const res = await s3Client.send(
    new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET_NAME!,
      Key: key,
    }),
  );

  const body = await res.Body?.transformToString();
  if (!body) throw new Error(`Failed to read text file from S3: ${key}`);
  return body;
}

async function loadLatestQuestionFileWithText(projectId: string): Promise<QuestionFileItem | null> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME!,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': QUESTION_FILE_PK,
        ':skPrefix': `${projectId}#`,
      },
    }),
  );

  const items = (res.Items ?? []) as QuestionFileItem[];
  const candidates = items.filter((i) => !!i.textFileKey);

  if (!candidates.length) return null;

  return candidates[0] ?? null;
}

async function queryCompanyKnowledgeBase(_args: {
  orgId: string;
  projectId: string;
  solicitationText: string;
}) {
  // TODO: wire to your vector KB / OpenSearch / Bedrock KB.
  return [];
}

function validateBriefStructure(brief: BriefPayload): string[] {
  const errors: string[] = [];

  if (!brief.scoring?.criteria) {
    errors.push('Missing scoring.criteria');
  }

  const requiredCriteria = [
    'technicalFit',
    'pastPerformanceRelevance',
    'pricingPosition',
    'strategicAlignment',
    'incumbentRisk',
  ];

  for (const key of requiredCriteria) {
    if (!brief.scoring?.criteria?.[key]) {
      errors.push(`Missing criterion: ${key}`);
    }
  }

  if (!brief.deadlines || !Array.isArray(brief.deadlines?.items)) {
    errors.push('Missing or invalid deadlines.items array');
  }

  if (!brief.finalRecommendation?.recommendation) {
    errors.push('Missing finalRecommendation.recommendation');
  }

  return errors;
}

function buildPrompt(input: {
  solicitationText: string;
  solicitationUrl?: string;
  documentKey?: string;
  companyContext?: any;
  kbMatches: any[];
}) {
  const system = [
    {
      type: 'text' as const,
      text: `You are an expert federal proposal analyst generating "Executive Opportunity Briefs" for rapid bid/no-bid decisions.

CRITICAL: Return ONLY valid JSON. No markdown, no code blocks, no explanatory text before or after the JSON object.

SCORING FRAMEWORK (1-5 scale for each criterion):

1. technicalFit: Can we deliver technically?
   - 1 = Major capability gaps, unlikely to meet requirements
   - 3 = Some gaps but potentially addressable
   - 5 = Perfect technical match, proven capabilities

2. pastPerformanceRelevance: Do we have relevant experience?
   - 1 = No relevant past performance
   - 3 = Some related experience, gaps exist
   - 5 = Direct, highly relevant past performance

3. pricingPosition: Can we compete on price?
   - 1 = Uncompetitive, cost structure too high
   - 3 = Competitive but tight margins
   - 5 = Strong pricing advantage, good margins

4. strategicAlignment: Does this build our portfolio?
   - 1 = Off-strategy, diverts from core focus
   - 3 = Neutral, neither helps nor hurts
   - 5 = Core strategy, high portfolio value

5. incumbentRisk: What's the recompete risk?
   - 1 = Heavily favored incumbent, very difficult
   - 3 = Moderate incumbent advantage
   - 5 = Open field or we are incumbent

Each criterion MUST include:
- score: integer 1-5
- confidence: float 0.0-1.0 (how confident are you in this score?)
- rationale: 1-2 sentence explanation
- evidence: array of specific supporting facts from solicitation

DEADLINE EXTRACTION RULES:
Extract ALL deadlines (not just submission deadline):
- Questions due date
- Site visit registration deadline
- Amendment cutoff date
- Proposal submission deadline
- Technical volume due
- Price volume due
- Orals/presentations scheduled
- Technical demos
- Award date (expected)
- Contract start date
- Phase deadlines (SBIR/STTR)
- Option period dates

Format each as: {label, datetime (ISO8601 if parseable), dateText (as written), requiredAction, timezone}
Flag urgent deadlines (< 7 days).

CONTACT DIRECTORY:
Differentiate roles clearly:
- Contracting Officer (CO): Award authority, legal questions
- Contract Specialist (CS): Administrative support
- Program/Project Manager (PM): Technical authority, program direction
- Contracting Officer's Representative (COR): Contract oversight
- Technical POC: Technical questions, specifications
- Small Business Liaison: Set-aside questions, small business concerns
- Other: Additional contacts (specify role)

Include: name, role, email, phone (if available)

RISK ASSESSMENT:
Identify red flags with severity levels:

HIGH severity (deal-breakers):
- Strong incumbent with past performance advantage
- Unrealistic timeline for deliverables
- Major technical capability gaps
- Set-aside restrictions we don't meet
- Unfavorable contract type for our business

MEDIUM severity (significant concerns):
- Missing required certifications (obtainable)
- Tight deadline but achievable
- Ambiguous requirements needing clarification
- Moderate competition expected
- Some teaming required

LOW severity (minor concerns):
- Administrative clarifications needed
- Standard compliance requirements
- Typical competitive environment

For each flag: {severity, flag, explanation, mitigation (if any)}

SUBMISSION COMPLIANCE:
Extract detailed requirements:
- Volume structure (technical, price, past performance)
- Page limits per volume
- Font requirements (size, type)
- Margin requirements
- File naming conventions
- Required forms and certifications
- Delivery method (electronic, hard copy)
- Number of copies required
- Packaging requirements

UNKNOWN HANDLING:
If information is not available in the solicitation:
- Use null for missing single values
- Use empty arrays [] for missing lists
- Add to riskAssessment.unknowns array
- NEVER fabricate data or make assumptions

Return JSON with these exact top-level keys:
{
  "quickSummary": {
    "title": string,
    "agency": string,
    "naics": string,
    "contractType": string,
    "estimatedValue": string,
    "setAside": string
  },
  "scoring": {
    "criteria": {
      "technicalFit": {...},
      "pastPerformanceRelevance": {...},
      "pricingPosition": {...},
      "strategicAlignment": {...},
      "incumbentRisk": {...}
    }
  },
  "deadlines": {
    "items": [{label, datetime, dateText, requiredAction, timezone, isUrgent}]
  },
  "requirementsSummary": {
    "scopeOverview": string,
    "keyDeliverables": string[],
    "mandatoryRequirements": string[],
    "evaluationCriteria": string[]
  },
  "contacts": {
    "items": [{name, role, email, phone, notes}]
  },
  "riskAssessment": {
    "redFlags": [{severity, flag, explanation, mitigation}],
    "unknowns": string[]
  },
  "submissionCompliance": {
    "volumes": [{name, pageLimit, requirements}],
    "formatsAndFonts": string,
    "requiredForms": string[],
    "deliveryMethod": string
  },
  "pastPerformanceSignals": {
    "incumbentInfo": string,
    "competitorInsights": string[],
    "relevantContracts": string[]
  },
  "finalRecommendation": {
    "recommendation": "GO" | "NO_GO" | "NEEDS_REVIEW",
    "confidence": float 0.0-1.0,
    "topReasons": string[],
    "nextSteps": string[]
  }
}`,
    },
  ];

  const userText = `Solicitation URL: ${input.solicitationUrl ?? 'N/A'}
Document Key: ${input.documentKey ?? 'N/A'}

Company context:
${JSON.stringify(input.companyContext ?? {}, null, 2)}

KB past performance matches (snippets):
${JSON.stringify(input.kbMatches ?? [], null, 2)}

Solicitation text:
"""
${truncateSolicitationText(input.solicitationText)}
"""

Analyze this solicitation and return the Executive Opportunity Brief as valid JSON only.`;

  const messages = [
    {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: userText }],
    },
  ];

  return { system, messages };
}

async function invokeBedrock(reqBody: any, maxRetries = 2): Promise<any> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const resp = await bedrock.send(
        new InvokeModelCommand({
          modelId: MODEL_ID,
          contentType: 'application/json',
          accept: 'application/json',
          body: Buffer.from(JSON.stringify(reqBody)),
        }),
      );
      return resp;
    } catch (err: any) {
      lastError = err;

      if (err.name === 'ThrottlingException' && attempt < maxRetries) {
        console.warn(`Bedrock throttled, retry ${attempt + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ---------------------------
// Handler
// ---------------------------

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) return apiResponse(400, { message: 'Request body is missing' });

  try {
    const raw = JSON.parse(event.body);

    const validation = GenerateExecutiveBriefSchema.safeParse(raw);
    if (!validation.success) {
      return apiResponse(400, {
        message: 'Validation failed',
        errors: validation.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const { projectId } = validation.data as DTO;

    // 1) Load project
    const project: any = await getProjectById(docClient, DB_TABLE_NAME!, projectId);

    const sortKey: string | undefined = project?.sort_key || project?.sortKey || project?.sk || project?.[SK_NAME];
    const orgId: string | undefined = project?.orgId || project?.organizationId;

    if (!sortKey) {
      return apiResponse(500, { message: 'Project sort_key missing (data integrity issue)' });
    }
    if (!orgId) {
      return apiResponse(500, { message: 'Project orgId missing (data integrity issue)' });
    }

    // 2) Find latest QUESTION_FILE with textFileKey
    const qf = await loadLatestQuestionFileWithText(projectId);
    if (!qf?.textFileKey) {
      return apiResponse(400, {
        message:
          'No question file with textFileKey found for this project. Ensure pipeline sets QUESTION_FILE.textFileKey.',
        projectId,
      });
    }

    // 3) Load solicitation text from S3
    const solicitationText = await loadTextFromS3(qf.textFileKey);

    // 4) KB enrichment (optional)
    const kbMatches = await queryCompanyKnowledgeBase({
      orgId,
      projectId,
      solicitationText,
    });

    // 5) Bedrock call (Claude Messages API) with retry
    const { system, messages } = buildPrompt({
      solicitationText,
      solicitationUrl: project?.solicitationUrl,
      documentKey: project?.documentKey,
      companyContext: project?.companyContext,
      kbMatches,
    });

    const reqBody = {
      anthropic_version: 'bedrock-2023-05-31',
      system,
      messages,
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
    };

    const resp = await invokeBedrock(reqBody);

    const decoded = new TextDecoder().decode(resp.body);
    const outer = JSON.parse(decoded);

    const modelText: string =
      outer?.content?.map((c: any) => c?.text).filter(Boolean).join('\n') ??
      outer?.completion ??
      '';

    const rawModelJson = safeParseJsonFromModel(modelText) as BriefPayload;

    // 6) Validate structure
    const validationErrors = validateBriefStructure(rawModelJson);
    if (validationErrors.length > 0) {
      console.warn('Brief validation warnings:', validationErrors);
      // Continue but log for monitoring
    }

    // 7) Ensure structure exists (no crashes)
    rawModelJson.scoring = rawModelJson.scoring ?? {};
    rawModelJson.scoring.criteria = rawModelJson.scoring.criteria ?? {};
    rawModelJson.scoring.composite = rawModelJson.scoring.composite ?? {};
    rawModelJson.finalRecommendation = rawModelJson.finalRecommendation ?? {};

    // Compute composite safely even if criteria keys are missing
    const composite = computeComposite(rawModelJson.scoring.criteria);

    rawModelJson.scoring.composite = {
      ...rawModelJson.scoring.composite,
      ...composite,
      confidence: clamp01(rawModelJson.scoring.composite?.confidence ?? composite.confidence),
      rationale:
        rawModelJson.scoring.composite?.rationale ??
        'Composite score derived from 5 criteria scores.',
      recommendation: composite.recommendation,
    };

    rawModelJson.finalRecommendation = {
      ...rawModelJson.finalRecommendation,
      recommendation: composite.recommendation,
      confidence: clamp01(rawModelJson.finalRecommendation?.confidence ?? composite.confidence),
      topReasons: rawModelJson.finalRecommendation?.topReasons ?? [],
      nextSteps: rawModelJson.finalRecommendation?.nextSteps ?? [],
    };

    const now = new Date().toISOString();

    const executiveBrief = {
      meta: {
        orgId,
        projectId,
        generatedAt: now,
        model: MODEL_ID,
        source: {
          solicitationUrl: project?.solicitationUrl,
          documentKey: project?.documentKey,
          questionFileId: qf.id ?? null,
          textFileKey: qf.textFileKey,
        },
        validationWarnings: validationErrors.length > 0 ? validationErrors : undefined,
      },
      ...rawModelJson,
    };

    // 8) Update Project item
    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME!,
        Key: {
          [PK_NAME]: PROJECT_PK,
          [SK_NAME]: sortKey,
        },
        ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
        UpdateExpression:
          'SET #brief = :brief, #briefUpdatedAt = :now, #solHash = :solHash, #updatedAt = :now',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
          '#brief': 'executiveBrief',
          '#briefUpdatedAt': 'executiveBriefUpdatedAt',
          '#solHash': 'solicitationHash',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':brief': executiveBrief,
          ':now': now,
          ':solHash': stableHash(solicitationText),
        },
      }),
    );

    return apiResponse(200, { ok: true, executiveBrief });
  } catch (err: any) {
    console.error('Error in generateExecutiveBrief handler:', err);

    if (err instanceof SyntaxError) return apiResponse(400, { message: 'Invalid JSON in request or response' });

    if (err?.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { message: 'Project not found' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err?.message ?? 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);
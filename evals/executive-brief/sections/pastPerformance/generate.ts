/**
 * promptfoo custom provider — Past Performance matching pipeline.
 *
 * Replicates the production pastperf/match-projects.ts flow:
 *   1. Load executive brief from DynamoDB
 *   2. Load solicitation text from S3
 *   3. Extract requirements from the brief's requirements section
 *   4. Search Pinecone for matching past projects
 *   5. Load full project details from DynamoDB
 *   6. Calculate match scores and gap analysis
 *   7. Return pastPerformanceJSON + context (solicitation + past projects)
 *
 * Env vars (loaded via --env-file .env):
 *   PINECONE_API_KEY, PINECONE_INDEX, DOCUMENTS_BUCKET,
 *   BEDROCK_REGION, REGION, DB_TABLE_NAME, ORG_ID,
 *   BEDROCK_EMBEDDING_MODEL_ID
 */

import { Pinecone } from '@pinecone-database/pinecone';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// ─── Config ──────────────────────────────────────────────────────────────────

const ORG_ID = process.env.ORG_ID ?? '';
const PINECONE_API_KEY = process.env.PINECONE_API_KEY ?? '';
const PINECONE_INDEX = process.env.PINECONE_INDEX ?? '';
const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET ?? '';
const DB_TABLE_NAME = process.env.DB_TABLE_NAME ?? '';
const BEDROCK_REGION =
  process.env.BEDROCK_REGION ?? process.env.REGION ?? 'us-east-1';
const BEDROCK_EMBEDDING_MODEL_ID =
  process.env.BEDROCK_EMBEDDING_MODEL_ID ?? 'amazon.titan-embed-text-v2:0';

const PK_NAME = 'partition_key';
const SK_NAME = 'sort_key';
const EXEC_BRIEF_PK = 'EXEC_BRIEF_PK';
const PAST_PROJECT_PK = 'PAST_PROJECT';
const QUESTION_FILE_PK = 'QUESTION_FILE';
const SIMILARITY_THRESHOLD = 0.2;
const TITAN_V2_SAFE_CHARS = 8_000;
const PAST_PERF_SEARCH_MAX_CHARS = 7_500;
const MAX_SOLICITATION_CHARS = 45_000;

// ─── Clients (lazy singletons) ──────────────────────────────────────────────

let pineconeClient: Pinecone | null = null;
let bedrockClient: BedrockRuntimeClient | null = null;
let ddbDocClient: DynamoDBDocumentClient | null = null;
let s3Client: S3Client | null = null;

const getPinecone = (): Pinecone => {
  if (!pineconeClient)
    pineconeClient = new Pinecone({ apiKey: PINECONE_API_KEY });
  return pineconeClient;
};

const getBedrock = (): BedrockRuntimeClient => {
  if (!bedrockClient)
    bedrockClient = new BedrockRuntimeClient({ region: BEDROCK_REGION });
  return bedrockClient;
};

const getDdb = (): DynamoDBDocumentClient => {
  if (!ddbDocClient) {
    const raw = new DynamoDBClient({ region: BEDROCK_REGION });
    ddbDocClient = DynamoDBDocumentClient.from(raw);
  }
  return ddbDocClient;
};

const getS3 = (): S3Client => {
  if (!s3Client) s3Client = new S3Client({ region: BEDROCK_REGION });
  return s3Client;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const truncateText = (text: string, maxLen: number): string =>
  text.length <= maxLen ? text : text.slice(0, maxLen) + '\n\n[TRUNCATED]';

const getItem = async (
  pk: string,
  sk: string,
): Promise<Record<string, unknown> | null> => {
  const res = await getDdb().send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: pk, [SK_NAME]: sk },
    }),
  );
  return (res.Item as Record<string, unknown>) ?? null;
};

// ─── Embedding ──────────────────────────────────────────────────────────────

const getEmbedding = async (text: string): Promise<number[]> => {
  const truncated = text.trim().slice(0, TITAN_V2_SAFE_CHARS);
  const response = await getBedrock().send(
    new InvokeModelCommand({
      modelId: BEDROCK_EMBEDDING_MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(JSON.stringify({ inputText: truncated })),
    }),
  );
  const result = JSON.parse(new TextDecoder().decode(response.body));
  const vector = result.embedding ?? result.vector;
  if (!vector || !Array.isArray(vector)) {
    throw new Error(`No embedding in Bedrock response: ${Object.keys(result)}`);
  }
  return vector;
};

// ─── Pinecone search for past projects ──────────────────────────────────────

interface PineconeMatch {
  projectId: string;
  score: number;
  metadata: Record<string, unknown>;
}

const searchPastProjects = async (
  orgId: string,
  queryText: string,
  topK: number,
): Promise<PineconeMatch[]> => {
  const embedding = await getEmbedding(queryText);
  const pc = getPinecone();
  const index = pc.Index(PINECONE_INDEX);

  const results = await index.namespace(orgId).query({
    vector: embedding,
    topK,
    includeMetadata: true,
    includeValues: false,
    filter: { type: { $eq: 'past_project' } },
  });

  return (results.matches ?? [])
    .filter((m) => (m.score ?? 0) >= SIMILARITY_THRESHOLD)
    .map((m) => ({
      projectId: (m.metadata as Record<string, unknown>)?.projectId as string ?? '',
      score: m.score ?? 0,
      metadata: (m.metadata ?? {}) as Record<string, unknown>,
    }));
};

// ─── Load past project from DynamoDB ────────────────────────────────────────

const getPastProject = async (
  orgId: string,
  projectId: string,
): Promise<Record<string, unknown> | null> => {
  const sk = `${orgId}#${projectId}`;
  return getItem(PAST_PROJECT_PK, sk);
};

// ─── Load solicitation text from S3 ─────────────────────────────────────────

const loadTextFromS3 = async (bucket: string, key: string): Promise<string> => {
  const res = await getS3().send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );
  return (await res.Body?.transformToString('utf-8')) ?? '';
};

const loadSolicitationForBrief = async (
  brief: Record<string, unknown>,
): Promise<string> => {
  const bucket = (brief.documentsBucket as string) || DOCUMENTS_BUCKET;
  const allTextKeys = (brief.allTextKeys as string[]) ?? [];
  const projectId = brief.projectId as string;
  const opportunityId = brief.opportunityId as string;

  // Also fetch live question files
  let dynamicKeys: string[] = [];
  try {
    const skPrefix = `${projectId}#${opportunityId}#`;
    let exclusiveStartKey: Record<string, unknown> | undefined;
    const items: Record<string, unknown>[] = [];
    do {
      const res = await getDdb().send(
        new QueryCommand({
          TableName: DB_TABLE_NAME,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
          ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
          ExpressionAttributeValues: { ':pk': QUESTION_FILE_PK, ':skPrefix': skPrefix },
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );
      if (res.Items?.length) items.push(...(res.Items as Record<string, unknown>[]));
      exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    dynamicKeys = items
      .filter((f) => f.textFileKey && f.status === 'PROCESSED')
      .map((f) => f.textFileKey as string);
  } catch (err) {
    console.warn('Failed to fetch live question files:', (err as Error)?.message);
  }

  const keys = Array.from(new Set([...dynamicKeys, ...allTextKeys.filter(Boolean)]));
  if (!keys.length) throw new Error('No text keys found for brief');

  const texts = await Promise.all(
    keys.map(async (key) => {
      try {
        return await loadTextFromS3(bucket, key);
      } catch {
        return '';
      }
    }),
  );

  const validTexts = texts.filter((t) => t.trim().length > 0);
  if (!validTexts.length) throw new Error('Failed to load any solicitation text');

  const merged =
    validTexts.length === 1
      ? validTexts[0]
      : validTexts.map((t, i) => `=== DOCUMENT ${i + 1} ===\n\n${t}`).join('\n\n');

  return truncateText(merged, MAX_SOLICITATION_CHARS);
};

// ─── Relevance scoring (mirrors production helpers) ─────────────────────────

const RELEVANCE_WEIGHTS = {
  technicalSimilarity: 0.40,
  domainSimilarity: 0.25,
  scaleSimilarity: 0.20,
  recency: 0.10,
  successMetrics: 0.05,
} as const;

interface MatchDetails {
  technicalSimilarity: number;
  domainSimilarity: number;
  scaleSimilarity: number;
  recency: number;
  successMetrics: number;
}

const calculateRelevanceScore = (details: MatchDetails): number =>
  Math.round(
    details.technicalSimilarity * RELEVANCE_WEIGHTS.technicalSimilarity +
    details.domainSimilarity * RELEVANCE_WEIGHTS.domainSimilarity +
    details.scaleSimilarity * RELEVANCE_WEIGHTS.scaleSimilarity +
    details.recency * RELEVANCE_WEIGHTS.recency +
    details.successMetrics * RELEVANCE_WEIGHTS.successMetrics,
  );

const calculateRecencyScore = (endDate: string | null | undefined): number => {
  if (!endDate) return 50;
  const yearsAgo = (Date.now() - new Date(endDate).getTime()) / (1000 * 60 * 60 * 24 * 365);
  if (yearsAgo <= 1) return 100;
  if (yearsAgo <= 2) return 90;
  if (yearsAgo <= 3) return 75;
  if (yearsAgo <= 5) return 50;
  if (yearsAgo <= 7) return 25;
  return 10;
};

const calculateSuccessMetricsScore = (rating: number | null | undefined): number => {
  if (!rating) return 50;
  return Math.round((rating / 5) * 100);
};

const calculateDomainSimilarity = (
  project: Record<string, unknown>,
  solicitationText: string,
): number => {
  const text = solicitationText.toLowerCase();
  let score = 0;
  let hasData = false;

  if (project.domain) {
    hasData = true;
    score += text.includes((project.domain as string).toLowerCase()) ? 40 : 10;
  }
  const naics = project.naicsCodes as string[] | undefined;
  if (naics?.length) {
    hasData = true;
    score += naics.some((n) => text.includes(n)) ? 30 : 10;
  }
  const techs = project.technologies as string[] | undefined;
  if (techs?.length) {
    hasData = true;
    const matched = techs.filter((t) => text.includes(t.toLowerCase())).length;
    score += Math.round((matched / techs.length) * 30);
  }
  return hasData ? Math.min(100, score) : 0;
};

const calculateScaleSimilarity = (project: Record<string, unknown>): number => {
  let score = 0;
  let hasData = false;
  const value = project.value as number | undefined;
  if (value) {
    hasData = true;
    if (value >= 10_000_000) score += 40;
    else if (value >= 5_000_000) score += 35;
    else if (value >= 1_000_000) score += 30;
    else if (value >= 500_000) score += 25;
    else if (value >= 100_000) score += 20;
    else score += 10;
  }
  const teamSize = project.teamSize as number | undefined;
  if (teamSize) {
    hasData = true;
    if (teamSize >= 50) score += 30;
    else if (teamSize >= 20) score += 25;
    else if (teamSize >= 10) score += 20;
    else if (teamSize >= 5) score += 15;
    else score += 10;
  }
  const duration = project.durationMonths as number | undefined;
  if (duration) {
    hasData = true;
    if (duration >= 24) score += 30;
    else if (duration >= 12) score += 25;
    else if (duration >= 6) score += 20;
    else score += 10;
  }
  return hasData ? Math.min(100, score) : 0;
};

const findMatchedRequirements = (
  project: Record<string, unknown>,
  requirements: string[],
): string[] => {
  const projectText = [
    project.title,
    project.description,
    project.technicalApproach,
    ...((project.achievements as string[]) || []),
    ...((project.technologies as string[]) || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return requirements.filter((req) => {
    const keywords = req.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    const matchCount = keywords.filter((k) => projectText.includes(k)).length;
    return matchCount >= Math.min(3, keywords.length * 0.3);
  });
};

// ─── Gap analysis (mirrors production) ──────────────────────────────────────

interface ProjectMatch {
  project: Record<string, unknown>;
  relevanceScore: number;
  matchDetails: MatchDetails;
  matchedRequirements: string[];
  narrative: string | null;
}

const performGapAnalysis = (
  requirements: Array<{ category?: string; requirement: string }>,
  matches: ProjectMatch[],
) => {
  const coverageItems: Array<{
    requirement: string;
    category: string | null;
    status: 'COVERED' | 'PARTIAL' | 'GAP';
    matchedProjectId: string | null;
    matchedProjectTitle: string | null;
    matchScore: number | null;
    recommendation: string | null;
  }> = [];
  const criticalGaps: string[] = [];
  const recommendations: string[] = [];

  for (const req of requirements) {
    let bestMatch: ProjectMatch | null = null;
    let bestScore = 0;

    for (const match of matches) {
      if (match.matchedRequirements.includes(req.requirement) && match.relevanceScore > bestScore) {
        bestScore = match.relevanceScore;
        bestMatch = match;
      }
    }

    let status: 'COVERED' | 'PARTIAL' | 'GAP';
    let recommendation: string | null = null;

    if (bestScore >= 80) {
      status = 'COVERED';
    } else if (bestScore >= 50) {
      status = 'PARTIAL';
      recommendation = `Consider strengthening narrative for: ${req.requirement}`;
    } else {
      status = 'GAP';
      criticalGaps.push(req.requirement);
      recommendation = `No strong past performance match. Consider teaming or subcontracting for: ${req.requirement}`;
    }

    coverageItems.push({
      requirement: req.requirement,
      category: req.category || null,
      status,
      matchedProjectId: (bestMatch?.project.projectId as string) || null,
      matchedProjectTitle: (bestMatch?.project.title as string) || null,
      matchScore: bestScore || null,
      recommendation,
    });
  }

  const coveredCount = coverageItems.filter((c) => c.status === 'COVERED').length;
  const partialCount = coverageItems.filter((c) => c.status === 'PARTIAL').length;
  const overallCoverage =
    coverageItems.length > 0
      ? Math.round(((coveredCount + partialCount * 0.5) / coverageItems.length) * 100)
      : 0;

  if (criticalGaps.length > 0) {
    recommendations.push(
      `${criticalGaps.length} critical gap(s) identified. Consider teaming arrangements or subcontractors with relevant experience.`,
    );
  }
  if (overallCoverage < 70) {
    recommendations.push(
      'Overall past performance coverage is below 70%. This may significantly impact win probability.',
    );
  }
  if (matches.length < 3) {
    recommendations.push(
      'Limited past performance examples available. Consider adding more past projects to the database.',
    );
  }

  return { coverageItems, overallCoverage, criticalGaps, recommendations };
};

// ─── Narrative generation ───────────────────────────────────────────────────

const generateNarrativeSummary = (
  matches: ProjectMatch[],
  gapAnalysis: ReturnType<typeof performGapAnalysis>,
): string => {
  const parts: string[] = [];
  if (matches.length === 0) {
    parts.push('No relevant past performance projects were found in the database.');
    parts.push('Consider adding past projects or exploring teaming arrangements.');
  } else {
    parts.push(`Found ${matches.length} relevant past performance project(s).`);
    const top = matches[0];
    if (top) {
      parts.push(
        `The strongest match is "${top.project.title}" with a ${top.relevanceScore}% relevance score.`,
      );
    }
  }
  if (gapAnalysis) {
    parts.push(`Overall past performance coverage: ${gapAnalysis.overallCoverage}%.`);
    if (gapAnalysis.criticalGaps.length > 0) {
      parts.push(
        `${gapAnalysis.criticalGaps.length} critical gap(s) identified that may require teaming or subcontracting.`,
      );
    }
  }
  return parts.join(' ');
};

// ─── Main matching pipeline ─────────────────────────────────────────────────

const runPastPerformanceMatching = async (
  executiveBriefId: string,
): Promise<{ output: string; context: string }> => {
  // 1. Load the executive brief
  const brief = await getItem(EXEC_BRIEF_PK, executiveBriefId);
  if (!brief) throw new Error(`Executive brief not found: ${executiveBriefId}`);

  const orgId = (brief.orgId as string) || ORG_ID;
  if (!orgId) throw new Error('No orgId found');

  // 2. Load solicitation text
  const solicitationText = await loadSolicitationForBrief(brief);

  // 3. Extract requirements from the brief
  const requirementsSection = (
    brief.sections as Record<string, { data?: Record<string, unknown> }>
  )?.requirements?.data;
  const requirements: string[] = [];

  if (requirementsSection?.requirements) {
    for (const req of requirementsSection.requirements as Array<{ requirement?: string }>) {
      if (req.requirement) requirements.push(req.requirement);
    }
  }
  if (requirements.length === 0) {
    const summarySection = (
      brief.sections as Record<string, { data?: Record<string, unknown> }>
    )?.summary?.data;
    if (summarySection?.summary) {
      requirements.push(summarySection.summary as string);
    }
  }

  // 4. Build search query and search Pinecone
  const reqText = requirements
    .map((r, i) => `${i + 1}. ${r}`)
    .join('\n')
    .slice(0, 3_000);
  const solicitationSnippet = solicitationText.slice(0, 4_000);
  const searchQuery = [
    'Requirements:',
    reqText,
    '',
    'Solicitation Summary:',
    solicitationSnippet,
  ]
    .join('\n')
    .slice(0, PAST_PERF_SEARCH_MAX_CHARS);

  const searchResults = await searchPastProjects(orgId, searchQuery, 10);

  // 5. Load full project details and calculate scores
  const matches: ProjectMatch[] = [];
  for (const result of searchResults) {
    const project = await getPastProject(orgId, result.projectId);
    if (!project || project.isArchived) continue;

    const technicalSimilarity = Math.round(result.score * 100);
    const domainSimilarity = calculateDomainSimilarity(project, solicitationText);
    const scaleSimilarity = calculateScaleSimilarity(project);
    const recency = calculateRecencyScore(project.endDate as string | null);
    const successMetrics = calculateSuccessMetricsScore(project.performanceRating as number | null);

    const matchDetails: MatchDetails = {
      technicalSimilarity,
      domainSimilarity,
      scaleSimilarity,
      recency,
      successMetrics,
    };
    const relevanceScore = calculateRelevanceScore(matchDetails);
    const matchedRequirements = findMatchedRequirements(project, requirements);

    matches.push({
      project,
      relevanceScore,
      matchDetails,
      matchedRequirements,
      narrative: null,
    });
  }

  // If no semantic matches, fall back to all projects
  if (matches.length === 0) {
    const skPrefix = `${orgId}#`;
    const res = await getDdb().send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
        ExpressionAttributeValues: { ':pk': PAST_PROJECT_PK, ':skPrefix': skPrefix },
        Limit: 5,
      }),
    );
    for (const item of (res.Items ?? []) as Record<string, unknown>[]) {
      if (item.isArchived) continue;
      const matchDetails: MatchDetails = {
        technicalSimilarity: 30,
        domainSimilarity: calculateDomainSimilarity(item, solicitationText),
        scaleSimilarity: calculateScaleSimilarity(item),
        recency: calculateRecencyScore(item.endDate as string | null),
        successMetrics: calculateSuccessMetricsScore(item.performanceRating as number | null),
      };
      matches.push({
        project: item,
        relevanceScore: calculateRelevanceScore(matchDetails),
        matchDetails,
        matchedRequirements: findMatchedRequirements(item, requirements),
        narrative: null,
      });
    }
  }

  // Sort and take top 5
  const topMatches = matches
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 5);

  // 6. Gap analysis
  const requirementsWithCategory = requirementsSection?.requirements
    ? (requirementsSection.requirements as Array<{ category?: string; requirement: string }>).map(
        (r) => ({ category: r.category, requirement: r.requirement }),
      )
    : requirements.map((r) => ({ requirement: r }));

  const gapAnalysis = performGapAnalysis(requirementsWithCategory, topMatches);

  // 7. Calculate confidence score
  const coverage =
    typeof gapAnalysis.overallCoverage === 'number' && !isNaN(gapAnalysis.overallCoverage)
      ? gapAnalysis.overallCoverage
      : 0;
  const confidenceScore = Math.round(
    coverage * 0.7 +
    (topMatches.length > 0 ? 20 : 0) +
    (gapAnalysis.criticalGaps.length === 0 ? 10 : 0),
  );

  // 8. Build the past performance section output
  const pastPerformanceData = {
    topMatches: topMatches.map((m) => ({
      project: {
        projectId: m.project.projectId,
        orgId: m.project.orgId,
        title: m.project.title,
        client: m.project.client,
        description: m.project.description,
        domain: m.project.domain ?? null,
        technologies: m.project.technologies ?? [],
        contractNumber: m.project.contractNumber ?? null,
        startDate: m.project.startDate ?? null,
        endDate: m.project.endDate ?? null,
        value: m.project.value ?? null,
        performanceRating: m.project.performanceRating ?? null,
        teamSize: m.project.teamSize ?? null,
        durationMonths: m.project.durationMonths ?? null,
      },
      relevanceScore: m.relevanceScore,
      matchDetails: m.matchDetails,
      matchedRequirements: m.matchedRequirements,
      narrative: m.narrative,
    })),
    gapAnalysis,
    narrativeSummary: generateNarrativeSummary(topMatches, gapAnalysis),
    confidenceScore,
    evidence: [],
  };

  // Build context: solicitation text + requirements + past project details + scoring
  const pastProjectContext = topMatches
    .map((m, i) => {
      const p = m.project;
      const lines = [`[PP-${i + 1}] Project: ${p.title}`, `Client: ${p.client}`];
      if (p.description) lines.push(`Description: ${(p.description as string).slice(0, 800)}`);
      if (p.domain) lines.push(`Domain: ${p.domain}`);
      if ((p.technologies as string[])?.length)
        lines.push(`Technologies: ${(p.technologies as string[]).join(', ')}`);
      if (p.value) lines.push(`Value: $${p.value}`);
      if (p.contractNumber) lines.push(`Contract: ${p.contractNumber}`);
      if (p.startDate) lines.push(`Start Date: ${p.startDate}`);
      if (p.endDate) lines.push(`End Date: ${p.endDate}`);
      if (p.performanceRating) lines.push(`Performance Rating: ${p.performanceRating}/5`);
      if (p.teamSize) lines.push(`Team Size: ${p.teamSize}`);
      if (p.durationMonths) lines.push(`Duration: ${p.durationMonths} months`);
      if ((p.achievements as string[])?.length)
        lines.push(`Achievements: ${(p.achievements as string[]).join('; ')}`);
      if (p.technicalApproach)
        lines.push(`Technical Approach: ${(p.technicalApproach as string).slice(0, 400)}`);
      lines.push(`Relevance Score: ${m.relevanceScore}%`);
      lines.push(`Match Details: technical=${m.matchDetails.technicalSimilarity}%, domain=${m.matchDetails.domainSimilarity}%, scale=${m.matchDetails.scaleSimilarity}%, recency=${m.matchDetails.recency}%, success=${m.matchDetails.successMetrics}%`);
      if (m.matchedRequirements.length > 0)
        lines.push(`Matched Requirements: ${m.matchedRequirements.join('; ')}`);
      return lines.join('\n');
    })
    .join('\n\n---\n\n');

  const requirementsContext = requirements.length > 0
    ? requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')
    : 'No specific requirements extracted.';

  const gapSummaryContext = [
    `Overall Coverage: ${gapAnalysis.overallCoverage}%`,
    `Critical Gaps (${gapAnalysis.criticalGaps.length}): ${gapAnalysis.criticalGaps.join('; ') || 'None'}`,
    `Recommendations: ${gapAnalysis.recommendations.join('; ') || 'None'}`,
    `Coverage Items: ${gapAnalysis.coverageItems.map(c => `${c.requirement} [${c.status}]`).join('; ')}`,
  ].join('\n');

  const context = [
    '=== SOLICITATION TEXT ===',
    solicitationText.slice(0, 10_000),
    '',
    '=== EXTRACTED REQUIREMENTS ===',
    requirementsContext,
    '',
    '=== PAST PROJECTS FROM DATABASE ===',
    pastProjectContext || 'No past projects found.',
    '',
    '=== GAP ANALYSIS SUMMARY ===',
    gapSummaryContext,
    '',
    `=== CONFIDENCE SCORE: ${confidenceScore}% ===`,
    `Narrative: ${pastPerformanceData.narrativeSummary}`,
  ].join('\n\n');

  return { output: JSON.stringify(pastPerformanceData, null, 2), context };
};

// ─── promptfoo entry point ──────────────────────────────────────────────────

class PastPerformanceProvider {
  id = () => 'past-performance-matching';

  callApi = async (
    prompt: string,
  ): Promise<{ output: string; error?: string }> => {
    const executiveBriefId = prompt.trim();
    if (!executiveBriefId) return { output: '', error: 'Empty executiveBriefId' };

    try {
      const { output, context } = await runPastPerformanceMatching(executiveBriefId);
      return {
        output: `${output}\n\n---CONTEXT_SEPARATOR---\n\n${context}`,
      };
    } catch (err) {
      return { output: '', error: (err as Error).message };
    }
  };
}

export default PastPerformanceProvider;

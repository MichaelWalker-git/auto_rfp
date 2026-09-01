import { v4 as uuidv4 } from 'uuid';
import { PutCommand, QueryCommand, UpdateCommand, DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './db';
import { requireEnv } from './env';
import { nowIso } from './date';
import { getEmbedding } from './embeddings';
import { initPineconeClient } from './pinecone';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { isUsableInMatching, redactForGeneration } from './past-performance-disclosure';
import {
  type PastProject,
  type CreatePastProjectDTO,
  type UpdatePastProjectDTO,
  type PastProjectMatch,
  type MatchDetails,
  type GapAnalysis,
  type RequirementCoverage,
  type DisclosureProposal,
  type ConfirmDisclosureRow,
  PAST_PROJECT_PK,
  createPastProjectSK,
  calculateRelevanceScore,
  calculateRecencyScore,
  calculateSuccessMetricsScore,
} from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ================================
// CRUD Operations
// ================================

export async function createPastProject(
  dto: CreatePastProjectDTO,
  createdBy: string
): Promise<PastProject> {
  const projectId = uuidv4();
  const now = nowIso();

  const project: PastProject = {
    projectId,
    orgId: dto.orgId,
    title: dto.title,
    client: dto.client,
    clientPOC: dto.clientPOC || null,
    contractNumber: dto.contractNumber || null,
    startDate: dto.startDate || null,
    endDate: dto.endDate || null,
    value: dto.value || null,
    description: dto.description,
    technicalApproach: dto.technicalApproach || null,
    achievements: dto.achievements || [],
    performanceRating: dto.performanceRating || null,
    domain: dto.domain || null,
    technologies: dto.technologies || [],
    naicsCodes: dto.naicsCodes || [],
    contractType: dto.contractType || null,
    setAside: dto.setAside || null,
    teamSize: dto.teamSize || null,
    durationMonths: dto.durationMonths || null,
    usageCount: 0,
    lastUsedAt: null,
    usedInBriefIds: [],
    freshnessStatus: 'ACTIVE',
    staleSince: null,
    staleReason: null,
    lastFreshnessCheck: null,
    reactivatedAt: null,
    reactivatedBy: null,
    createdAt: now,
    updatedAt: now,
    createdBy,
    isArchived: false,
    extractionSource: dto.extractionSource || null,
    // Disclosure gating — fail-closed. An initial disclosure may be supplied on
    // create, but it is never trusted until confirmed via the review endpoint.
    disclosure: dto.disclosure ?? 'PERMISSION_REQUIRED',
    disclosureConfirmed: false,
    disclosureContactNote: dto.disclosureContactNote ?? null,
    disclosureReviewedBy: null,
    disclosureReviewedAt: null,
    disclosureProposed: null,
    disclosureRationale: null,
    disclosureSignals: [],
    disclosureConfidence: null,
    disclosureClassifiedAt: null,
  };

  const sk = createPastProjectSK(dto.orgId, projectId);

  await docClient.send(
    new PutCommand({
      TableName: DB_TABLE_NAME,
      Item: {
        [PK_NAME]: PAST_PROJECT_PK,
        [SK_NAME]: sk,
        ...project,
      },
    })
  );

  // Index to Pinecone for semantic search
  await indexPastProjectToPinecone(dto.orgId, project);

  // NOTE: we deliberately do NOT auto-classify disclosure here. A fire-and-forget
  // dispatch is unreliable in Lambda (work not awaited before the handler returns
  // is frozen and usually never runs), and awaiting a Bedrock call on every create
  // adds latency/cost. New rows are fail-closed (disclosureConfirmed=false) and the
  // disclosure review page's "Classify all" reliably proposes for any unproposed row.
  return project;
}

export async function getPastProject(
  orgId: string,
  projectId: string
): Promise<PastProject | null> {
  const sk = createPastProjectSK(orgId, projectId);

  const result = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: PAST_PROJECT_PK,
        [SK_NAME]: sk,
      },
    })
  );

  if (!result.Item) return null;

  return result.Item as PastProject;
}

export async function updatePastProject(
  orgId: string,
  projectId: string,
  dto: UpdatePastProjectDTO
): Promise<PastProject | null> {
  const existing = await getPastProject(orgId, projectId);
  if (!existing) return null;

  const sk = createPastProjectSK(orgId, projectId);
  const now = nowIso();

  // Build update expression dynamically
  const updateParts: string[] = ['#updatedAt = :updatedAt'];
  const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
  const values: Record<string, any> = { ':updatedAt': now };

  const fields = [
    'title', 'client', 'clientPOC', 'contractNumber', 'startDate', 'endDate',
    'value', 'description', 'technicalApproach', 'achievements', 'performanceRating',
    'domain', 'technologies', 'naicsCodes', 'contractType', 'setAside',
    'teamSize', 'durationMonths', 'isArchived',
    // Disclosure note + level are editable via the generic update; confirmation
    // is intentionally excluded — it flips only through the review endpoint.
    'disclosure', 'disclosureContactNote',
  ];

  for (const field of fields) {
    if (field in dto) {
      updateParts.push(`#${field} = :${field}`);
      names[`#${field}`] = field;
      values[`:${field}`] = (dto as any)[field];
    }
  }

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: PAST_PROJECT_PK,
        [SK_NAME]: sk,
      },
      UpdateExpression: `SET ${updateParts.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    })
  );

  const updated = await getPastProject(orgId, projectId);

  // Re-index to Pinecone if content changed
  if (updated && (dto.title || dto.description || dto.technicalApproach || dto.achievements || dto.technologies)) {
    await indexPastProjectToPinecone(orgId, updated);
  }

  return updated;
}

// ================================
// Disclosure classification & review
// ================================

/**
 * Persist an AI classification proposal. Writes ONLY the `disclosureProposed*`
 * fields — never `disclosure` or `disclosureConfirmed`, which change only
 * through human confirmation (fail-closed).
 *
 * `p.projectId` comes from LLM-echoed output, so it may be hallucinated / for
 * the wrong org / an altered UUID. The `attribute_exists` guard prevents writing
 * a bare item; a non-matching id raises `ConditionalCheckFailedException`, which
 * we swallow (return false) rather than letting it reject the caller's batch and
 * lose every valid proposal alongside it. Mirrors `confirmDisclosureRows`.
 *
 * @returns true if the row was updated, false if no such project existed (skipped).
 */
export async function saveDisclosureProposal(orgId: string, p: DisclosureProposal): Promise<boolean> {
  const sk = createPastProjectSK(orgId, p.projectId);
  const now = nowIso();

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: PAST_PROJECT_PK,
          [SK_NAME]: sk,
        },
        UpdateExpression:
          'SET #disclosureProposed = :proposed, #disclosureRationale = :rationale, ' +
          '#disclosureSignals = :signals, #disclosureConfidence = :confidence, ' +
          '#disclosureClassifiedAt = :classifiedAt, #updatedAt = :updatedAt',
        // Only update rows that already exist — never create a bare item.
        ConditionExpression: 'attribute_exists(#pk)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#disclosureProposed': 'disclosureProposed',
          '#disclosureRationale': 'disclosureRationale',
          '#disclosureSignals': 'disclosureSignals',
          '#disclosureConfidence': 'disclosureConfidence',
          '#disclosureClassifiedAt': 'disclosureClassifiedAt',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':proposed': p.proposed,
          ':rationale': p.rationale,
          ':signals': p.signals,
          ':confidence': p.confidence,
          ':classifiedAt': now,
          ':updatedAt': now,
        },
      }),
    );
    return true;
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === 'ConditionalCheckFailedException') {
      // Model echoed a projectId with no matching row — skip it, don't fail the batch.
      console.warn(`saveDisclosureProposal: no project ${p.projectId} in org ${orgId}; skipping proposal`);
      return false;
    }
    throw err;
  }
}

/**
 * Apply a batch of human confirm/override decisions. This is the ONLY path that
 * flips `disclosureConfirmed` to true and stamps the reviewer. Rows whose
 * project no longer exists are skipped. Returns the number of rows updated.
 */
export async function confirmDisclosureRows(
  orgId: string,
  rows: ConfirmDisclosureRow[],
  reviewedBy: string,
  reviewedAt: string,
): Promise<number> {
  let updated = 0;

  for (const row of rows) {
    const sk = createPastProjectSK(orgId, row.projectId);
    try {
      await docClient.send(
        new UpdateCommand({
          TableName: DB_TABLE_NAME,
          Key: {
            [PK_NAME]: PAST_PROJECT_PK,
            [SK_NAME]: sk,
          },
          UpdateExpression:
            'SET #disclosure = :disclosure, #disclosureConfirmed = :confirmed, ' +
            '#disclosureContactNote = :note, #disclosureReviewedBy = :reviewedBy, ' +
            '#disclosureReviewedAt = :reviewedAt, #updatedAt = :updatedAt',
          ConditionExpression: 'attribute_exists(#pk)',
          ExpressionAttributeNames: {
            '#pk': PK_NAME,
            '#disclosure': 'disclosure',
            '#disclosureConfirmed': 'disclosureConfirmed',
            '#disclosureContactNote': 'disclosureContactNote',
            '#disclosureReviewedBy': 'disclosureReviewedBy',
            '#disclosureReviewedAt': 'disclosureReviewedAt',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':disclosure': row.disclosure,
            ':confirmed': true,
            ':note': row.disclosureContactNote ?? null,
            ':reviewedBy': reviewedBy,
            ':reviewedAt': reviewedAt,
            ':updatedAt': reviewedAt,
          },
        }),
      );
      updated += 1;
    } catch (err) {
      // Skip rows whose project no longer exists (ConditionalCheckFailed) but
      // surface anything unexpected.
      const name = (err as { name?: string })?.name;
      if (name !== 'ConditionalCheckFailedException') {
        console.error(`confirmDisclosureRows: failed to update ${row.projectId}:`, err);
        throw err;
      }
    }
  }

  return updated;
}

export async function deletePastProject(
  orgId: string,
  projectId: string,
  hardDelete: boolean = false
): Promise<boolean> {
  const sk = createPastProjectSK(orgId, projectId);

  if (hardDelete) {
    await docClient.send(
      new DeleteCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: PAST_PROJECT_PK,
          [SK_NAME]: sk,
        },
      })
    );

    // Remove from Pinecone
    await deletePastProjectFromPinecone(orgId, projectId);
  } else {
    // Soft delete - just archive
    await updatePastProject(orgId, projectId, { isArchived: true });
  }

  return true;
}

export async function listPastProjects(
  orgId: string,
  includeArchived: boolean = false,
  limit: number = 50,
  nextToken?: string
): Promise<{ items: PastProject[]; nextToken?: string; total: number }> {
  const items: PastProject[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  if (nextToken) {
    try {
      ExclusiveStartKey = JSON.parse(Buffer.from(nextToken, 'base64').toString());
    } catch {
      // Invalid token, start from beginning
    }
  }

  const result = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': PAST_PROJECT_PK,
        ':skPrefix': `${orgId}#`,
      },
      Limit: limit,
      ExclusiveStartKey,
    })
  );

  for (const item of result.Items || []) {
    const project = item as PastProject;
    if (includeArchived || !project.isArchived) {
      items.push(project);
    }
  }

  let newNextToken: string | undefined;
  if (result.LastEvaluatedKey) {
    newNextToken = Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64');
  }

  return {
    items,
    nextToken: newNextToken,
    total: items.length,
  };
}

/**
 * Drain every page of past projects for an org. `listPastProjects` returns a
 * single page (default 50), which silently truncates callers that need the whole
 * library (classification, reindex). Use this when "all" really means all.
 */
export async function listAllPastProjects(
  orgId: string,
  includeArchived: boolean = false,
): Promise<PastProject[]> {
  const allProjects: PastProject[] = [];
  let nextToken: string | undefined;

  do {
    const result = await listPastProjects(orgId, includeArchived, 100, nextToken);
    allProjects.push(...result.items);
    nextToken = result.nextToken;
  } while (nextToken);

  return allProjects;
}

export async function reindexAllPastProjects(
  orgId: string
): Promise<{ indexed: number; failed: string[] }> {
  const allProjects = await listAllPastProjects(orgId);

  let indexed = 0;
  const failed: string[] = [];

  for (const project of allProjects) {
    try {
      await indexPastProjectToPinecone(orgId, project);
      indexed++;
      console.log(`Reindexed ${indexed}/${allProjects.length}: ${project.title}`);
    } catch (err) {
      console.error(`Failed to index project ${project.projectId}:`, err);
      failed.push(project.projectId);
    }
  }

  return { indexed, failed };
}

// ================================
// Pinecone Operations
// ================================

export async function indexPastProjectToPinecone(
  orgId: string,
  project: PastProject
): Promise<string> {
  const client = await initPineconeClient();
  const index = client.Index(requireEnv('PINECONE_INDEX'));

  // Create rich text for embedding.
  // NOTE: the client name is intentionally excluded — a project may be
  // NDA/permission-gated, so vector recall must not key on a name we may
  // not be allowed to use. Disclosure gating reads the authoritative record
  // from DynamoDB, never Pinecone metadata.
  const textForEmbedding = [
    `Project: ${project.title}`,
    `Description: ${project.description}`,
    project.technicalApproach ? `Technical Approach: ${project.technicalApproach}` : '',
    project.domain ? `Domain: ${project.domain}` : '',
    project.technologies.length ? `Technologies: ${project.technologies.join(', ')}` : '',
    project.achievements.length ? `Achievements: ${project.achievements.join('. ')}` : '',
    project.naicsCodes.length ? `NAICS: ${project.naicsCodes.join(', ')}` : '',
  ].filter(Boolean).join('\n\n');

  const embedding = await getEmbedding(textForEmbedding, orgId);
  const id = `past_project#${project.projectId}`;

  await index.namespace(orgId).upsert([
    {
      id,
      values: embedding,
      metadata: {
        id,
        type: 'past_project',
        projectId: project.projectId,
        title: project.title,
        // client intentionally NOT indexed — disclosure gating re-reads the
        // authoritative record from DynamoDB rather than trusting stale metadata.
        domain: project.domain || '',
        technologies: project.technologies,
        naicsCodes: project.naicsCodes,
        value: project.value || 0,
        performanceRating: project.performanceRating || 0,
        startDate: project.startDate || '',
        endDate: project.endDate || '',
        teamSize: project.teamSize || 0,
        durationMonths: project.durationMonths || 0,
        createdAt: project.createdAt,
      },
    },
  ]);

  console.log(`Pinecone: indexed past project ${id}`);
  return id;
}

export async function deletePastProjectFromPinecone(
  orgId: string,
  projectId: string
): Promise<void> {
  const client = await initPineconeClient();
  const index = client.Index(requireEnv('PINECONE_INDEX'));
  const id = `past_project#${projectId}`;

  try {
    await index.namespace(orgId).deleteOne(id);
    console.log(`Pinecone: deleted past project ${id}`);
  } catch (err) {
    console.error('Pinecone delete error:', err);
  }
}

export async function searchPastProjects(
  orgId: string,
  queryText: string,
  topK: number = 5
): Promise<Array<{ projectId: string; score: number; metadata: any }>> {
  try {
    const client = await initPineconeClient();
  const index = client.Index(requireEnv('PINECONE_INDEX'));

    const embedding = await getEmbedding(queryText, orgId);

    const results = await index.namespace(orgId).query({
      vector: embedding,
      topK,
      includeMetadata: true,
      includeValues: false,
      filter: {
        type: { $eq: 'past_project' },
      },
    });

    return (results.matches || []).map((match) => ({
      projectId: (match.metadata as any)?.projectId || '',
      score: match.score || 0,
      metadata: match.metadata,
    }));
  } catch (err) {
    console.warn('searchPastProjects failed (non-fatal):', (err as Error)?.message);
    return [];
  }
}

// ================================
// Matching & Scoring
// ================================

// Titan Text Embeddings V2: ~1.3–1.5 chars/token, max 8192 tokens.
// Keep the combined search query under 7,500 chars to stay safely within the limit.
const PAST_PERF_SEARCH_MAX_CHARS = 7_500;

export async function matchProjectsToRequirements(
  orgId: string,
  requirements: string[],
  solicitationText: string,
  topK: number = 5
): Promise<PastProjectMatch[]> {
  // Combine requirements and solicitation for comprehensive search.
  // Truncate each part to stay within Titan's 8192-token limit.
  const reqText = requirements
    .map((r, i) => `${i + 1}. ${r}`)
    .join('\n')
    .slice(0, 3_000);

  const solicitationSnippet = solicitationText.slice(0, 4_000);

  const combined = [
    'Requirements:',
    reqText,
    '',
    'Solicitation Summary:',
    solicitationSnippet,
  ].join('\n');

  const searchQuery = combined.slice(0, PAST_PERF_SEARCH_MAX_CHARS);

  // Search for similar past projects
  const searchResults = await searchPastProjects(orgId, searchQuery, topK * 2);

  // Load full project details and calculate detailed scores
  const matches: PastProjectMatch[] = [];

  for (const result of searchResults) {
    if (result.score < 0.4) continue;

    const project = await getPastProject(orgId, result.projectId);
    if (!project || project.isArchived) continue;
    // Disclosure gate: DO_NOT_USE never enters a match; non-NAMEABLE projects
    // have their identifying fields redacted before the match is persisted.
    if (!isUsableInMatching(project)) continue;

    // Calculate detailed match scores
    const matchDetails = await calculateMatchDetails(
      project,
      requirements,
      solicitationText,
      result.score
    );

    const relevanceScore = calculateRelevanceScore(matchDetails);

    // Find which requirements this project matches
    const matchedRequirements = findMatchedRequirements(project, requirements);

    matches.push({
      project: redactForGeneration(project),
      relevanceScore,
      matchDetails,
      matchedRequirements,
      narrative: null, // Will be generated separately
    });
  }

  // If no semantic matches found, fall back to returning all projects from DB
  if (matches.length === 0) {
    console.log('No semantic matches found, falling back to all projects');
    const { items: allProjects } = await listPastProjects(orgId, false, topK);

    for (const project of allProjects) {
      // Same disclosure gate as the semantic branch.
      if (!isUsableInMatching(project)) continue;

      const matchDetails: MatchDetails = {
        technicalSimilarity: 0,
        domainSimilarity: calculateDomainSimilarity(project, solicitationText),
        scaleSimilarity: calculateScaleSimilarity(project, solicitationText),
        recency: calculateRecencyScore(project.endDate),
        successMetrics: calculateSuccessMetricsScore(project.performanceRating),
      };

      const relevanceScore = calculateRelevanceScore(matchDetails);
      const matchedRequirements = findMatchedRequirements(project, requirements);

      matches.push({
        project: redactForGeneration(project),
        relevanceScore,
        matchDetails,
        matchedRequirements,
        narrative: null,
      });
    }
  }

  // Sort by relevance score and return top K
  // Always return at least some results for testing purposes
  return matches
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, topK);
}

async function calculateMatchDetails(
  project: PastProject,
  _requirements: string[],
  solicitationText: string,
  semanticScore: number
): Promise<MatchDetails> {
  const rawTechnicalSimilarity = Math.round(semanticScore * 100);

  const domainSimilarity = calculateDomainSimilarity(project, solicitationText);

  // If zero domain overlap, cap technical similarity — semantic noise isn't real relevance
  const technicalSimilarity = domainSimilarity === 0
    ? Math.min(rawTechnicalSimilarity, 15)
    : rawTechnicalSimilarity;

  const scaleSimilarity = calculateScaleSimilarity(project, solicitationText);
  const recency = calculateRecencyScore(project.endDate);
  const successMetrics = calculateSuccessMetricsScore(project.performanceRating);

  return {
    technicalSimilarity,
    domainSimilarity,
    scaleSimilarity,
    recency,
    successMetrics,
  };
}

function calculateDomainSimilarity(project: PastProject, solicitationText: string): number {
  const text = solicitationText.toLowerCase();
  let score = 0;
  let hasAnyData = false;

  // Check domain match
  if (project.domain) {
    hasAnyData = true;
    const domain = project.domain.toLowerCase();
    if (text.includes(domain)) {
      score += 40;
    } else {
      score += 10; // Has domain but doesn't match
    }
  }

  // Check NAICS code match
  if (project.naicsCodes && project.naicsCodes.length > 0) {
    hasAnyData = true;
    for (const naics of project.naicsCodes) {
      if (text.includes(naics)) {
        score += 30;
        break;
      }
    }
    if (score < 30) {
      score += 10; // Has NAICS but doesn't match
    }
  }

  // Check technology match
  if (project.technologies && project.technologies.length > 0) {
    hasAnyData = true;
    let techMatches = 0;
    for (const tech of project.technologies) {
      if (text.includes(tech.toLowerCase())) {
        techMatches++;
      }
    }
    const techMatchRatio = techMatches / project.technologies.length;
    score += Math.round(techMatchRatio * 30);
  }

  // If no domain data at all, return 0
  if (!hasAnyData) {
    return 0;
  }

  return Math.min(100, score);
}

function calculateScaleSimilarity(project: PastProject, _solicitationText: string): number {
  // This is a simplified calculation - in production, you'd extract
  // estimated value and team size from the solicitation using _solicitationText
  let score = 0;
  let hasAnyData = false;

  // Contract value scoring
  if (project.value) {
    hasAnyData = true;
    if (project.value >= 10000000) score += 40; // $10M+
    else if (project.value >= 5000000) score += 35; // $5M+
    else if (project.value >= 1000000) score += 30; // $1M+
    else if (project.value >= 500000) score += 25; // $500K+
    else if (project.value >= 100000) score += 20; // $100K+
    else score += 10; // Any value
  }

  // Team size scoring
  if (project.teamSize) {
    hasAnyData = true;
    if (project.teamSize >= 50) score += 30;
    else if (project.teamSize >= 20) score += 25;
    else if (project.teamSize >= 10) score += 20;
    else if (project.teamSize >= 5) score += 15;
    else score += 10; // Any team size
  }

  // Duration scoring
  if (project.durationMonths) {
    hasAnyData = true;
    if (project.durationMonths >= 24) score += 30;
    else if (project.durationMonths >= 12) score += 25;
    else if (project.durationMonths >= 6) score += 20;
    else score += 10; // Any duration
  }

  // If no scale data at all, return 0
  if (!hasAnyData) {
    return 0;
  }

  return Math.min(100, score);
}

function findMatchedRequirements(project: PastProject, requirements: string[]): string[] {
  const matched: string[] = [];
  const projectText = [
    project.title,
    project.description,
    project.technicalApproach,
    ...project.achievements,
    ...project.technologies,
  ].filter(Boolean).join(' ').toLowerCase();

  for (const req of requirements) {
    // Simple keyword matching - in production, use semantic similarity
    const keywords = req.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const matchCount = keywords.filter(k => projectText.includes(k)).length;
    
    if (matchCount >= Math.min(3, keywords.length * 0.3)) {
      matched.push(req);
    }
  }

  return matched;
}

// ================================
// Gap Analysis
// ================================

export async function performGapAnalysis(
  _orgId: string,
  requirements: Array<{ category?: string; requirement: string }>,
  matches: PastProjectMatch[]
): Promise<GapAnalysis> {
  // Note: _orgId is available for future enhancement to fetch additional org-specific data
  const coverageItems: RequirementCoverage[] = [];
  const criticalGaps: string[] = [];
  const recommendations: string[] = [];

  for (const req of requirements) {
    // Find best matching project for this requirement
    let bestMatch: PastProjectMatch | null = null;
    let bestScore = 0;

    for (const match of matches) {
      if (match.matchedRequirements.includes(req.requirement)) {
        if (match.relevanceScore > bestScore) {
          bestScore = match.relevanceScore;
          bestMatch = match;
        }
      }
    }

    // Determine coverage status
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
      matchedProjectId: bestMatch?.project.projectId || null,
      matchedProjectTitle: bestMatch?.project.title || null,
      matchScore: bestScore || null,
      recommendation,
    });
  }

  // Calculate overall coverage
  const coveredCount = coverageItems.filter(c => c.status === 'COVERED').length;
  const partialCount = coverageItems.filter(c => c.status === 'PARTIAL').length;
  const overallCoverage = coverageItems.length > 0
    ? Math.round(((coveredCount * 1.0 + partialCount * 0.5) / coverageItems.length) * 100)
    : 0;

  // Generate recommendations
  if (criticalGaps.length > 0) {
    recommendations.push(
      `${criticalGaps.length} critical gap(s) identified. Consider teaming arrangements or subcontractors with relevant experience.`
    );
  }

  if (overallCoverage < 70) {
    recommendations.push(
      'Overall past performance coverage is below 70%. This may significantly impact win probability.'
    );
  }

  if (matches.length < 3) {
    recommendations.push(
      'Limited past performance examples available. Consider adding more past projects to the database.'
    );
  }

  return {
    coverageItems,
    overallCoverage,
    criticalGaps,
    recommendations,
  };
}

// ================================
// Usage Tracking
// ================================

/**
 * Track usage of a past performance project in an executive brief.
 * Updates lastUsedAt, usageCount, and usedInBriefIds.
 */
export async function trackPastProjectUsage(
  orgId: string,
  projectId: string,
  briefId: string,
): Promise<void> {
  const sk = createPastProjectSK(orgId, projectId);
  const now = nowIso();

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: PAST_PROJECT_PK,
          [SK_NAME]: sk,
        },
        UpdateExpression:
          'SET #lastUsedAt = :now, #usageCount = if_not_exists(#usageCount, :zero) + :one, #usedInBriefIds = list_append(if_not_exists(#usedInBriefIds, :emptyList), :briefList), #updatedAt = :now',
        ExpressionAttributeNames: {
          '#lastUsedAt': 'lastUsedAt',
          '#usageCount': 'usageCount',
          '#usedInBriefIds': 'usedInBriefIds',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':now': now,
          ':zero': 0,
          ':one': 1,
          ':emptyList': [],
          ':briefList': [briefId],
        },
      }),
    );
    console.log(`Tracked usage of past project ${projectId} in brief ${briefId}`);
  } catch (error) {
    console.error(`Failed to track usage for past project ${projectId}:`, error);
    // Don't throw - tracking is best-effort
  }
}
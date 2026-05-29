/**
 * GET /opportunity-context
 *
 * Returns the relevant context items for an opportunity:
 * 1. Loads the persisted record (if any) for user overrides
 * 2. If no record exists or ?refresh=true, runs semantic search against
 *    KB, Past Performance, and Content Library using the solicitation text
 * 3. Merges auto-suggested items with user overrides (pinned / excluded)
 * 4. Persists the refreshed suggestions back to DynamoDB
 *
 * Query params:
 *   projectId    (required)
 *   opportunityId (required)
 *   orgId        (required)
 *   refresh      (optional, "true" forces re-search even if cached)
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { nowIso } from '@/helpers/date';
import { putItem, getItem } from '@/helpers/db';
import {
  loadAllSolicitationTexts,
  queryCompanyKnowledgeBase,
} from '@/helpers/executive-opportunity-brief';
import { getEmbedding, semanticSearchContentLibrary } from '@/helpers/embeddings';
import { searchPastProjects, listPastProjects } from '@/helpers/past-performance';
import { loadTextFromS3 } from '@/helpers/s3';
import { requireEnv } from '@/helpers/env';
import type { PineconeHit } from '@/helpers/pinecone';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

import {
  OPPORTUNITY_CONTEXT_PK,
  createOpportunityContextSK,
  ContextItemSchema,
  type ContextItem,
  type ContextOverride,
  type OpportunityContextRecord,
} from '@auto-rfp/core';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const MAX_SOLICITATION_CHARS = 80_000;
// Titan Text Embeddings V2 tokenizer averages ~1.3–1.5 chars/token for English text.
// Keep search queries under 8,000 chars to stay safely within the 8,192-token limit.
const MAX_SEARCH_QUERY_CHARS = 7_500;
// Pinecone cosine similarity scores for Titan embeddings typically range 0.1–0.6.
// Lower thresholds to avoid filtering out valid matches.
const KB_MIN_SCORE = 0.20;
const PAST_PERF_MIN_SCORE = 0.15;
const CONTENT_LIB_MIN_SCORE = 0.20;
const KB_TOP_K = 15;
const PAST_PERF_TOP_K = 5;
const CONTENT_LIB_TOP_K = 10;
const PREVIEW_CHARS = 300;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildSearchQuery(solicitation: string): string {
  return solicitation.slice(0, MAX_SEARCH_QUERY_CHARS).trim();
}

function makePreview(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > PREVIEW_CHARS ? clean.slice(0, PREVIEW_CHARS) + '…' : clean;
}

async function loadChunkText(chunkKey: string): Promise<string> {
  try {
    return await loadTextFromS3(DOCUMENTS_BUCKET, chunkKey);
  } catch {
    return '';
  }
}

// ─── Context Searchers ────────────────────────────────────────────────────────

async function searchKnowledgeBase(orgId: string, searchQuery: string): Promise<ContextItem[]> {
  try {
    const matches = await queryCompanyKnowledgeBase(orgId, searchQuery, KB_TOP_K);
    if (!matches?.length) return [];

    const items = await Promise.all(
      matches
        .filter((m) => (m.score ?? 0) >= KB_MIN_SCORE)
        .map(async (m, i): Promise<ContextItem | null> => {
          const chunkKey = m.source?.chunkKey as string | undefined;
          const rawText = chunkKey ? await loadChunkText(chunkKey) : '';
          if (!rawText) return null;

          const parsed = ContextItemSchema.safeParse({
            id: chunkKey ?? `kb-${i}`,
            source: 'KNOWLEDGE_BASE',
            title: (m.source?.documentId as string | undefined)
              ? `KB Document: ${m.source?.documentId}`
              : `Knowledge Base Chunk #${i + 1}`,
            preview: makePreview(rawText),
            relevanceScore: m.score,
            metadata: {
              documentId: m.source?.documentId,
              chunkKey,
            },
          });
          return parsed.success ? parsed.data : null;
        }),
    );

    return items.filter((item): item is ContextItem => item !== null);
  } catch (err) {
    console.warn('KB search failed:', (err as Error)?.message);
    return [];
  }
}

async function searchPastPerformance(orgId: string, searchQuery: string): Promise<ContextItem[]> {
  try {
    const results = await searchPastProjects(orgId, searchQuery, PAST_PERF_TOP_K);
    const relevant = (results ?? []).filter((r) => (r.score ?? 0) >= PAST_PERF_MIN_SCORE);

    if (relevant.length) {
      return relevant.map((r): ContextItem => ({
        id: r.metadata?.projectId as string ?? `pp-${r.score}`,
        source: 'PAST_PERFORMANCE',
        title: (r.metadata?.title as string | undefined) ?? 'Past Performance Project',
        preview: makePreview(
          [
            r.metadata?.client ? `Client: ${r.metadata.client}` : '',
            r.metadata?.domain ? `Domain: ${r.metadata.domain}` : '',
            r.metadata?.description as string | undefined ?? '',
          ]
            .filter(Boolean)
            .join(' | '),
        ),
        relevanceScore: r.score,
        metadata: r.metadata as Record<string, unknown>,
      }));
    }

    // Fallback: list all projects if semantic search returned nothing
    const { items } = await listPastProjects(orgId, false, PAST_PERF_TOP_K);
    return items.map((p): ContextItem => ({
      id: p.projectId,
      source: 'PAST_PERFORMANCE',
      title: p.title,
      preview: makePreview(
        [
          p.client ? `Client: ${p.client}` : '',
          p.domain ? `Domain: ${p.domain}` : '',
          p.description ?? '',
        ]
          .filter(Boolean)
          .join(' | '),
      ),
      relevanceScore: undefined,
      metadata: {
        client: p.client,
        domain: p.domain,
        technologies: p.technologies,
        value: p.value,
        performanceRating: p.performanceRating,
      },
    }));
  } catch (err) {
    console.warn('Past performance search failed:', (err as Error)?.message);
    return [];
  }
}

async function searchContentLibrary(orgId: string, searchQuery: string): Promise<ContextItem[]> {
  try {
    const embedding = await getEmbedding(searchQuery);
    const hits = await semanticSearchContentLibrary(orgId, embedding, CONTENT_LIB_TOP_K);
    if (!hits?.length) return [];

    const items = await Promise.all(
      hits
        .filter((h) => (h.score ?? 0) >= CONTENT_LIB_MIN_SCORE)
        .map(async (h, i): Promise<ContextItem | null> => {
          const chunkKey = h.source?.chunkKey as string | undefined;
          const rawText = chunkKey ? await loadChunkText(chunkKey) : '';

          const parsed = ContextItemSchema.safeParse({
            id: chunkKey ?? `cl-${i}`,
            source: 'CONTENT_LIBRARY',
            title: (h.source?.documentId as string | undefined)
              ? `Content Library: ${h.source?.documentId}`
              : `Content Snippet #${i + 1}`,
            preview: rawText ? makePreview(rawText) : 'No preview available',
            relevanceScore: h.score,
            metadata: {
              documentId: h.source?.documentId,
              chunkKey,
            },
          });
          return parsed.success ? parsed.data : null;
        }),
    );

    return items.filter((item): item is ContextItem => item !== null);
  } catch (err) {
    console.warn('Content library search failed:', (err as Error)?.message);
    return [];
  }
}

// ─── DynamoDB helpers ─────────────────────────────────────────────────────────

async function loadRecord(
  orgId: string,
  projectId: string,
  opportunityId: string,
): Promise<OpportunityContextRecord | null> {
  return getItem<OpportunityContextRecord>(
    OPPORTUNITY_CONTEXT_PK,
    createOpportunityContextSK(orgId, projectId, opportunityId),
  );
}

async function saveRecord(record: OpportunityContextRecord): Promise<void> {
  await putItem(
    OPPORTUNITY_CONTEXT_PK,
    createOpportunityContextSK(record.orgId, record.projectId, record.opportunityId),
    record,
    true, // preserveCreatedAt
  );
}

// ─── Handler ──────────────────────────────────────────────────────────────────

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(401, { error: 'Unauthorized' });

  const q = event.queryStringParameters ?? {};
  const { projectId, opportunityId } = q;
  const forceRefresh = q.refresh === 'true';

  if (!projectId || !opportunityId) {
    return apiResponse(400, { error: 'projectId and opportunityId are required' });
  }

  // 1. Load existing record
  const existing = await loadRecord(orgId, projectId, opportunityId);
  const overrides: ContextOverride[] = existing?.overrides ?? [];
  const excludedIds = new Set(
    overrides.filter((o) => o.action === 'EXCLUDED').map((o) => o.id),
  );
  const pinnedOverrides = overrides.filter((o) => o.action === 'PINNED');

  // 2. Decide whether to re-run semantic search
  const needsRefresh = forceRefresh || !existing?.suggestedItems?.length;

  let suggestedItems: ContextItem[] = existing?.suggestedItems ?? [];
  let lastRefreshedAt: string | undefined = existing?.lastRefreshedAt;

  if (needsRefresh) {
    // Load solicitation text for semantic search
    let solicitation = '';
    try {
      solicitation = await loadAllSolicitationTexts(
        projectId,
        opportunityId,
        MAX_SOLICITATION_CHARS,
      );
    } catch {
      // No solicitation uploaded yet — return empty suggestions
    }

    if (solicitation.trim()) {
      const searchQuery = buildSearchQuery(solicitation);

      // Run all three searches in parallel
      const [kbItems, ppItems, clItems] = await Promise.all([
        searchKnowledgeBase(orgId, searchQuery),
        searchPastPerformance(orgId, searchQuery),
        searchContentLibrary(orgId, searchQuery),
      ]);

      suggestedItems = [...kbItems, ...ppItems, ...clItems];

      // Sort by relevance score descending (items without score go last)
      suggestedItems.sort(
        (a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0),
      );

      console.log(
        `Context search: kb=${kbItems.length}, pp=${ppItems.length}, cl=${clItems.length} items`,
      );

      // Persist refreshed suggestions
      const now = nowIso();
      lastRefreshedAt = now;
      const record: OpportunityContextRecord = {
        projectId,
        opportunityId,
        orgId,
        suggestedItems,
        overrides,
        lastRefreshedAt: now,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await saveRecord(record);
    }
  }

  // 3. Build pinned items list (from overrides, merging with any matching suggested item)
  const suggestedById = new Map(suggestedItems.map((item) => [item.id, item]));
  const pinnedItems: ContextItem[] = pinnedOverrides.map((o) => {
    // Use the full item from suggestions if available, otherwise reconstruct from override
    return (
      suggestedById.get(o.id) ?? {
        id: o.id,
        source: o.source,
        title: o.label ?? o.id,
        preview: '',
        relevanceScore: undefined,
      }
    );
  });

  // 4. Filter suggested items: remove excluded and already-pinned
  const pinnedIds = new Set(pinnedOverrides.map((o) => o.id));
  const filteredSuggestions = suggestedItems.filter(
    (item) => !excludedIds.has(item.id) && !pinnedIds.has(item.id),
  );

  return apiResponse(200, {
    ok: true,
    suggestedItems: filteredSuggestions,
    pinnedItems,
    excludedIds: [...excludedIds],
    lastRefreshedAt,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read')),
);

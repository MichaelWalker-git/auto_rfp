import { invokeModel } from '@/helpers/bedrock-http-client';
import { requireEnv } from '@/helpers/env';
import { listAllPastProjects, getPastProject } from '@/helpers/past-performance';
import { queryCompanyKnowledgeBase } from '@/helpers/executive-opportunity-brief';
import { loadTextFromS3 } from '@/helpers/s3';
import { parseJsonFromResponse } from '@/helpers/ai-json';
import { ExtractedDisclosureSchema, type DisclosureProposal, type PastProject } from '@auto-rfp/core';
import {
  DISCLOSURE_CLASSIFY_SYSTEM_PROMPT,
  createDisclosureClassifyUserPrompt,
} from '@/constants/disclosure-prompts';

// Classification runs on a fast model (Sonnet) pinned by the classify-disclosure
// route's extraEnv. We intentionally provide NO literal fallback: if a Lambda
// imports this helper without BEDROCK_MODEL_ID set, fail loud at load time rather
// than silently invoking a wrong/legacy model on the wrong function. Any route
// that uses the classifier MUST pin an active BEDROCK_MODEL_ID. See the
// bedrock-model-id-pinning note: never hard-code a model id as a helper default.
const BEDROCK_MODEL_ID = requireEnv('BEDROCK_MODEL_ID');

/** Number of projects packed into a single model call. */
const CLASSIFY_BATCH_SIZE = 5;

/**
 * Max batches (each = one Bedrock call + KB query + S3 reads) in flight at once.
 * Bounds fan-out so a large org (confirm allows up to 200 rows; a forced
 * reclassify can target the whole library) can't spawn ceil(N/5) simultaneous
 * Bedrock calls and trip throttling / blow the 29s gateway ceiling. 4 concurrent
 * batches = 20 projects in flight — enough throughput to stay fast for typical
 * orgs, capped so large orgs degrade gracefully (later batches queue) rather
 * than failing en masse.
 */
const CLASSIFY_MAX_CONCURRENCY = 4;

/** Known-blocked client names, org-configurable later; env-seeded for v1. */
const knownBlockedClients = (): string[] =>
  (process.env.DISCLOSURE_BLOCKED_CLIENTS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * Map over items with a bounded number of concurrent workers, preserving input
 * order in the result. Keeps at most `limit` promises in flight at once.
 */
const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  };
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
};

/** Call Bedrock and return the model's text content, or null. */
const callBedrock = async (systemPrompt: string, userPrompt: string): Promise<string | null> => {
  const requestBody = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  };
  const responseBody = await invokeModel(BEDROCK_MODEL_ID, JSON.stringify(requestBody));
  const parsed = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as {
    content?: Array<{ type: string; text?: string }>;
  };
  return parsed.content?.find((c) => c.type === 'text')?.text ?? null;
};

/** Pull NDA / permission signal text from the company KB for a project. */
const loadKbSignals = async (orgId: string, client: string): Promise<string> => {
  const documentsBucket = process.env.DOCUMENTS_BUCKET ?? '';
  const hits = await queryCompanyKnowledgeBase(
    orgId,
    `${client} NDA non-disclosure confidentiality case study permission`,
    4,
  ).catch(() => []);
  if (!hits?.length || !documentsBucket) return '';
  const texts = await Promise.all(
    hits.map((h) =>
      h.source?.chunkKey
        ? loadTextFromS3(documentsBucket, h.source.chunkKey).catch(() => '')
        : Promise.resolve(''),
    ),
  );
  return texts.filter(Boolean).join('\n').slice(0, 2000);
};

const buildPayloadForProject = async (orgId: string, p: PastProject): Promise<string> => {
  const kbText = await loadKbSignals(orgId, p.client);
  const blocked = knownBlockedClients();
  return [
    `--- projectId: ${p.projectId} ---`,
    `Client: ${p.client}`,
    `Title: ${p.title}`,
    `Domain: ${p.domain ?? 'N/A'}`,
    p.contractNumber ? `Contract: ${p.contractNumber}` : '',
    `KnownBlockedListHit: ${blocked.some((b) => p.client.toLowerCase().includes(b.toLowerCase()))}`,
    kbText ? `KB/contract signals:\n${kbText}` : 'KB/contract signals: none found',
  ]
    .filter(Boolean)
    .join('\n');
};

export const classifyDisclosure = async (
  orgId: string,
  projectIds?: string[],
  force = false,
): Promise<{ proposals: DisclosureProposal[]; classified: number; failed: string[] }> => {
  // Resolve target projects. The "all" branch must cover the WHOLE library —
  // listPastProjects returns a single 50-row page, which would silently classify
  // only the first 50 and read as "classified everything".
  const projects: PastProject[] = projectIds?.length
    ? (await Promise.all(projectIds.map((id) => getPastProject(orgId, id)))).filter(
        (p): p is PastProject => !!p,
      )
    : await listAllPastProjects(orgId);

  const targets = projects.filter((p) => force || !p.disclosureProposed);

  // Run batches concurrently but BOUNDED. Fully-serial calls (~10s each) blow the
  // 30s gateway ceiling; unbounded Promise.all fans ceil(N/5) Bedrock calls out at
  // once and trips throttling on large orgs. Cap in-flight batches to keep both in
  // check — later batches queue behind the workers.
  const batchResults = await mapWithConcurrency(
    chunk(targets, CLASSIFY_BATCH_SIZE),
    CLASSIFY_MAX_CONCURRENCY,
    (batch) => classifyBatch(orgId, batch),
  );

  const proposals = batchResults.flatMap((r) => r.proposals);
  const failed = batchResults.flatMap((r) => r.failed);

  return { proposals, classified: proposals.length, failed };
};

/** Classify a single batch of projects in one model call. Never throws. */
const classifyBatch = async (
  orgId: string,
  batch: PastProject[],
): Promise<{ proposals: DisclosureProposal[]; failed: string[] }> => {
  const proposals: DisclosureProposal[] = [];
  const failed: string[] = [];
  try {
    const payload = (await Promise.all(batch.map((p) => buildPayloadForProject(orgId, p)))).join(
      '\n\n',
    );
    const raw = await callBedrock(
      DISCLOSURE_CLASSIFY_SYSTEM_PROMPT,
      createDisclosureClassifyUserPrompt(payload),
    );
    const parsedRows = raw ? parseJsonFromResponse(raw) : null;
    if (!parsedRows) {
      return { proposals, failed: batch.map((p) => p.projectId) };
    }
    for (const obj of parsedRows) {
      const { success, data } = ExtractedDisclosureSchema.safeParse(obj);
      const projectId = (obj as { projectId?: string })?.projectId;
      if (!success || !projectId) {
        if (projectId) failed.push(projectId);
        continue;
      }
      proposals.push({ projectId, ...data });
    }
  } catch (err) {
    // Log the underlying cause — otherwise a model/access failure looks like a
    // silent per-project "failed" with no diagnostic (e.g. Legacy/EOL model id).
    console.error(
      `[disclosure] batch classification failed for [${batch.map((p) => p.projectId).join(', ')}]:`,
      (err as Error)?.message ?? err,
    );
    return { proposals, failed: batch.map((p) => p.projectId) };
  }
  return { proposals, failed };
};

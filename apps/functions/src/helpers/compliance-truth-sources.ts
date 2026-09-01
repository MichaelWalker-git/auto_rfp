/**
 * Truth-source access layer for the factual-accuracy compliance checks (C1–C5).
 *
 * A thin, reusable seam over the org's internal sources of truth — company
 * profile, knowledge base (content library), certifications, past performance —
 * shared by the full-review augmenters and the `verify_company_facts` chat tool.
 *
 * Golden rule (NFR-2): every loader is BEST-EFFORT. A truth-source outage must
 * NEVER fail a review, so each function catches and degrades to `null` / `[]`.
 * The callers layer their own `try/catch → []` on top; this is defence in depth.
 *
 * Gating is enforced HERE, in code — not as a model-prompt instruction:
 *   - KB retrieval hard-gates to APPROVED && !isArchived && freshnessStatus ACTIVE (FR-6).
 *   - Past-performance respects the disclosure gate: DO_NOT_USE is dropped and
 *     non-NAMEABLE records are redacted via `redactForGeneration` (FR-7) so a
 *     withheld client name can never reach a finding.
 */
import { getItem } from '@/helpers/db';
import { getEmbedding } from '@/helpers/embeddings';
import { getCompanyProfile, type CompanyProfileDBItem } from '@/helpers/company-profile';
import { semanticSearchContentLibrary } from '@/helpers/semantic-search';
import { getPastProject, searchPastProjects } from '@/helpers/past-performance';
import {
  getEffectiveDisclosure,
  isUsableInMatching,
  redactForGeneration,
} from '@/helpers/past-performance-disclosure';
import { SK_NAME } from '@/constants/common';
import { CONTENT_LIBRARY_PK, type ContentLibraryItem, type PastProject } from '@auto-rfp/core';

// ─── Return shapes (internal aggregation types, mirrors PackageInventory) ────

/** A knowledge-base answer that passed the APPROVED/ACTIVE hard-gate. */
export interface KbHit {
  itemId: string;
  question: string;
  answer: string;
  category: string;
  score: number;
  /** ISO cert expiry if the item carries one (KB is the primary expiry source — D4). */
  certExpiryDate: string | null;
}

/**
 * A certification record the org can be verified against. Sourced KB-primary
 * (content-library items in a CERTIFICATION-like category) then profile-secondary
 * (company-profile `fields[category==='CERTIFICATION']` + the small-business cert).
 */
export interface CertRecord {
  source: 'kb' | 'profile';
  label: string;
  /** Whether the record is considered trustworthy (APPROVED / verified). */
  verified: boolean;
  /** ISO expiry date if known — may be null/unparseable (best-effort). */
  expiresAt: string | null;
}

/** A past-performance fact, already NDA-redacted (safe to surface in findings). */
export interface PastPerfFact {
  projectId: string;
  title: string;
  /** Redacted client label for non-NAMEABLE projects — never the real name. */
  client: string;
  description: string;
  value: number | null;
  contractNumber: string | null;
  score: number;
}

/**
 * A canonical client-identifying string that must be withheld (project is
 * non-NAMEABLE). Carries the owning project + which field it came from so a
 * leak finding can explain the source without re-printing beyond the leak spot.
 */
export interface WithheldName {
  projectId: string;
  name: string;
  kind: 'client' | 'poc-name' | 'poc-organization';
}

/** One priced service line from the solution plan's cost schedule (concrete amount only). */
export interface SolutionPlanCostLine {
  label: string;
  amount: number;
  billing: string;
  category: string;
  optional: boolean;
}

/**
 * One STAFFED team line from the plan's structured `planTeam` (C6c). Only FILLED
 * lines carry a name — a line the check can contradict a package staffing claim
 * against. UNFILLED (open role, no person) and DELETED-employee lines (the person
 * left the pool) are dropped by the loader: there is no authoritative "this role
 * is staffed by X" to check the package against.
 */
export interface SolutionPlanTeamLine {
  /** The person assigned to `role` (FILLED-line `nameSnapshot`). */
  name: string;
  /** The role/position the person fills. */
  role: string;
}

/**
 * The latest approved solution plan for an opportunity + its plain-text body and
 * structured priced cost lines. Used as a source of truth for C6 (package must be
 * true to the plan's approach/team/prices/services).
 */
export interface SolutionPlanFacts {
  planId: string;
  version: number;
  isStale: boolean;
  /** Plain text of the plan HTML (approach/team/services/timeline/risks). */
  text: string;
  /** Cost items with a concrete amount (null-amount "vendor quote" lines dropped). */
  costItems: SolutionPlanCostLine[];
  currency: string;
  /**
   * FILLED team lines (person + role) from the structured `planTeam` (C6c). The
   * roster is a plan sidecar written AFTER synthesis — it is NOT in `text` — so
   * team consistency needs this structured source, not the prose check (C6b).
   */
  teamMembers: SolutionPlanTeamLine[];
}

// ─── Loaders ─────────────────────────────────────────────────────────────────

/** Company profile snapshot — best-effort, `null` on any failure. */
export const loadCompanyFacts = async (orgId: string): Promise<CompanyProfileDBItem | null> => {
  try {
    return await getCompanyProfile(orgId);
  } catch (err) {
    console.warn('[compliance-truth-sources] loadCompanyFacts failed:', (err as Error)?.message);
    return null;
  }
};

/** Best-effort load of one content-library item by its Pinecone-returned SK. */
const loadContentLibraryItem = async (sk: string | undefined): Promise<ContentLibraryItem | null> => {
  if (!sk) return null;
  try {
    return await getItem<ContentLibraryItem>(CONTENT_LIBRARY_PK, sk);
  } catch {
    return null;
  }
};

/**
 * The FR-6 hard-gate: a KB item may inform a finding only when it is APPROVED,
 * not archived, and freshness ACTIVE. Enforced in code (never a prompt line) so
 * it cannot be bypassed by the model.
 */
export const isKbItemUsable = (item: ContentLibraryItem): boolean =>
  item.approvalStatus === 'APPROVED' && !item.isArchived && item.freshnessStatus === 'ACTIVE';

/**
 * Semantic KB search scoped to the given query, hard-gated to APPROVED/ACTIVE
 * content-library entries. Returns `[]` on any failure or empty result.
 */
export const searchKnowledgeBase = async (
  orgId: string,
  query: string,
  k: number,
  kbIds?: string[],
): Promise<KbHit[]> => {
  try {
    if (!query.trim()) return [];
    const embedding = await getEmbedding(query, orgId);
    const hits = await semanticSearchContentLibrary(orgId, embedding, k, kbIds);
    const loaded = await Promise.all(
      hits.map(async (hit) => {
        const item = await loadContentLibraryItem(hit.source?.[SK_NAME] as string | undefined);
        if (!item || !isKbItemUsable(item)) return null;
        return {
          itemId: item.id,
          question: item.question,
          answer: item.answer,
          category: item.category,
          score: hit.score ?? 0,
          // Carried from the already-loaded item (loaded via the real
          // Pinecone-returned SK) so cert expiry needs no second fetch and no
          // SK-format guess — which would miss legacy 3-part content-library SKs.
          certExpiryDate: item.certExpiryDate ?? null,
        } satisfies KbHit;
      }),
    );
    return loaded.filter((h): h is KbHit => h !== null);
  } catch (err) {
    console.warn('[compliance-truth-sources] searchKnowledgeBase failed:', (err as Error)?.message);
    return [];
  }
};

// Certification-like content-library categories / labels. Loose on purpose —
// Stage 2 (the model) is the precision gate; over-collecting here is fine.
const CERT_CATEGORY_RE = /cert|compliance|accreditation|iso|cmmi|fedramp|soc|hipaa|nist|set[-\s]?aside/i;

/**
 * Certification records relevant to a claim. KB-primary (content-library items
 * in a cert-like category, gated) then profile-secondary (profile
 * `fields[category==='CERTIFICATION']` + the structured small-business cert).
 * `verified` reflects APPROVED (KB) / `field.verified` (profile). Best-effort.
 */
export const loadCertRecords = async (orgId: string, claim: string): Promise<CertRecord[]> => {
  const records: CertRecord[] = [];

  // KB-primary: semantic search restricted to cert-like categories. KB is the
  // PRIMARY expiry source (D4) — certExpiryDate rides along on the KbHit from
  // the item searchKnowledgeBase already loaded, so no second fetch / SK guess.
  try {
    const hits = await searchKnowledgeBase(orgId, claim || 'certifications set-aside compliance', 8);
    for (const hit of hits) {
      if (!CERT_CATEGORY_RE.test(hit.category) && !CERT_CATEGORY_RE.test(hit.question)) continue;
      records.push({
        source: 'kb',
        label: hit.question,
        // A hit only survives searchKnowledgeBase if it is APPROVED/ACTIVE.
        verified: true,
        expiresAt: hit.certExpiryDate,
      });
    }
  } catch {
    /* best-effort */
  }

  // Profile-secondary: CERTIFICATION fields + the structured small-business cert.
  try {
    const profile = await loadCompanyFacts(orgId);
    if (profile) {
      for (const field of profile.fields ?? []) {
        if (field.category !== 'CERTIFICATION') continue;
        records.push({
          source: 'profile',
          label: field.label || field.key,
          verified: field.verified === true,
          expiresAt: field.expiresAt ?? null,
        });
      }
      if (profile.smallBusinessCertId) {
        records.push({
          source: 'profile',
          label: profile.smallBusinessCertId,
          verified: true,
          expiresAt: profile.smallBusinessCertExpiration ?? null,
        });
      }
    }
  } catch {
    /* best-effort */
  }

  return records;
};

/**
 * Best-matching USABLE past-performance records for a query, already redacted
 * for generation (non-NAMEABLE → client label withheld, contractNumber nulled).
 * DO_NOT_USE projects are dropped. Returns `[]` on any failure.
 */
export const searchPastPerformanceUsable = async (
  orgId: string,
  query: string,
  k: number,
): Promise<PastPerfFact[]> => {
  try {
    if (!query.trim()) return [];
    const hits = await searchPastProjects(orgId, query, k);
    const loaded = await Promise.all(
      hits.map(async (hit) => {
        if (!hit.projectId) return null;
        const project = await getPastProject(orgId, hit.projectId).catch(() => null);
        if (!project || project.isArchived) return null;
        if (!isUsableInMatching(project)) return null;
        const safe = redactForGeneration(project);
        return {
          projectId: safe.projectId,
          title: safe.title,
          client: safe.client,
          description: safe.description,
          value: safe.value ?? null,
          contractNumber: safe.contractNumber ?? null,
          score: hit.score ?? 0,
        } satisfies PastPerfFact;
      }),
    );
    return loaded.filter((f): f is PastPerfFact => f !== null);
  } catch (err) {
    console.warn('[compliance-truth-sources] searchPastPerformanceUsable failed:', (err as Error)?.message);
    return [];
  }
};

/**
 * Every client-identifying string that must be withheld: for each project whose
 * effective disclosure is NOT NAMEABLE, collect `[client, clientPOC.name,
 * clientPOC.organization]`. Drains ALL pages (not top-K) — C5 must see the whole
 * withheld set to catch every leak. Returns `[]` on any failure.
 */
export const listWithheldClientNames = async (orgId: string): Promise<WithheldName[]> => {
  try {
    // Lazy import avoids a cycle (past-performance imports disclosure which is fine,
    // but keeping the heavy list-all here local to the one caller that needs it).
    const { listAllPastProjects } = await import('@/helpers/past-performance');
    const projects = await listAllPastProjects(orgId, true);
    const out: WithheldName[] = [];
    for (const project of projects) {
      if (getEffectiveDisclosure(project) === 'NAMEABLE') continue;
      const push = (name: string | null | undefined, kind: WithheldName['kind']) => {
        const trimmed = (name ?? '').trim();
        if (trimmed.length > 0) out.push({ projectId: project.projectId, name: trimmed, kind });
      };
      push(project.client, 'client');
      push(project.clientPOC?.name, 'poc-name');
      push(project.clientPOC?.organization, 'poc-organization');
    }
    return out;
  } catch (err) {
    console.warn('[compliance-truth-sources] listWithheldClientNames failed:', (err as Error)?.message);
    return [];
  }
};

/**
 * The latest READY solution plan for an opportunity, as plain text + structured
 * priced cost lines. Best-effort → `null` on any failure or when no READY plan
 * exists (nothing to check the package against). A stale-but-READY plan IS
 * returned — the latest plan is the reference, mirroring document generation.
 *
 * `loadApprovedSolutionPlanContext` lives in the heavy document-generation
 * worker; it is lazy-imported so the compliance-review cold start never pulls
 * the whole doc-gen graph (mirrors the `listAllPastProjects` lazy import above).
 */
export const loadSolutionPlanFacts = async (
  orgId: string,
  projectId: string,
  oppId: string,
): Promise<SolutionPlanFacts | null> => {
  try {
    const { loadApprovedSolutionPlanContext } = await import('@/helpers/generate-document-worker');
    const context = await loadApprovedSolutionPlanContext({ orgId, projectId, opportunityId: oppId });
    if (!context) return null;
    const { plan, text } = context;
    const schedule = plan.costSchedule ?? null;
    const costItems: SolutionPlanCostLine[] = (schedule?.items ?? [])
      // Drop "vendor quote required" lines — no concrete figure to contradict.
      .filter((item): item is typeof item & { amount: number } => typeof item.amount === 'number')
      .map((item) => ({
        label: item.label,
        amount: item.amount,
        billing: item.billing,
        category: item.category,
        optional: item.optional ?? false,
      }));
    // FILLED team lines only (C6c): a line with a real person assigned. UNFILLED
    // (open role) and DELETED-employee lines carry no authoritative staffing to
    // check the package against, so they are dropped here. We read the raw
    // `planTeam` field, not the GET endpoint's derived team — a stale nameSnapshot
    // is the value the package was written from, which is exactly what we compare.
    const teamMembers: SolutionPlanTeamLine[] = (plan.planTeam?.members ?? [])
      .filter((m) => !m.removedEmployee && m.employeeId && m.nameSnapshot)
      .map((m) => ({ name: m.nameSnapshot!.trim(), role: m.role.trim() }))
      .filter((m) => m.name.length > 0 && m.role.length > 0);
    return {
      planId: plan.id,
      version: plan.version,
      isStale: plan.isStale ?? false,
      text,
      costItems,
      currency: schedule?.currency ?? 'USD',
      teamMembers,
    };
  } catch (err) {
    console.warn('[compliance-truth-sources] loadSolutionPlanFacts failed:', (err as Error)?.message);
    return null;
  }
};

// Re-exported for callers that want the raw disclosure predicate without a
// second import.
export type { PastProject };

import { v4 as uuidv4 } from 'uuid';
import {
  type ExtractionJob,
  type CreateExtractionJobDTO,
  type PastProjectDraft,
  type PastProject,
  type PastProjectFieldConfidence,
  type DuplicateWarning,
  type ExtractionSource,
  type LaborRateDraft,
  type BOMItemDraft,
  type DraftType,
  EXTRACTION_JOB_PK,
  createExtractionJobSK,
  DRAFT_PAST_PROJECT_PK,
  createDraftPastProjectSK,
  DRAFT_LABOR_RATE_PK,
  createDraftLaborRateSK,
  DRAFT_BOM_ITEM_PK,
  createDraftBOMItemSK,
} from '@auto-rfp/core';
import { createItem, getItem, updateItem, queryBySkPrefix, deleteItem } from './db';
import { nowIso } from './date';
import { PK_NAME, SK_NAME } from '../constants/common';
import { createPastProject } from './past-performance';
import { updateLaborRate, createBOMItem } from './pricing';

// ================================
// Types
// ================================

// Re-export DraftType from core for backward compatibility
export type { DraftType };
export type AnyDraft = PastProjectDraft | LaborRateDraft | BOMItemDraft;

interface DraftConfig<T extends AnyDraft> {
  pk: string;
  buildSK: (orgId: string, id: string) => string;
  getIdField: () => keyof T;
  defaultExpireDays: number;
}

const DRAFT_CONFIGS: Record<DraftType, DraftConfig<AnyDraft>> = {
  PAST_PERFORMANCE: {
    pk: DRAFT_PAST_PROJECT_PK,
    buildSK: createDraftPastProjectSK,
    getIdField: () => 'projectId' as keyof AnyDraft,
    defaultExpireDays: 30,
  },
  LABOR_RATE: {
    pk: DRAFT_LABOR_RATE_PK,
    buildSK: createDraftLaborRateSK,
    getIdField: () => 'draftId' as keyof AnyDraft,
    defaultExpireDays: 7,
  },
  BOM_ITEM: {
    pk: DRAFT_BOM_ITEM_PK,
    buildSK: createDraftBOMItemSK,
    getIdField: () => 'draftId' as keyof AnyDraft,
    defaultExpireDays: 7,
  },
};

// ================================
// S3 Key Builders
// ================================

export const PAST_PERF_SOURCES_PREFIX = 'extraction-sources/past-performance';
export const PRICING_SOURCES_PREFIX = 'extraction-sources/pricing';

export const buildSourceDocumentKey = (
  targetType: DraftType,
  orgId: string,
  fileId: string,
  fileName: string
): string => {
  const prefix = targetType === 'PAST_PERFORMANCE'
    ? PAST_PERF_SOURCES_PREFIX
    : PRICING_SOURCES_PREFIX;
  const extension = fileName.split('.').pop() || 'pdf';
  return `${prefix}/${orgId}/${fileId}.${extension}`;
};

// ================================
// Extraction Job Helpers
// ================================

export const createExtractionJobRecord = async (
  dto: CreateExtractionJobDTO,
  userId: string
): Promise<ExtractionJob> => {
  const jobId = uuidv4();
  const now = nowIso();

  const job: ExtractionJob = {
    jobId,
    orgId: dto.orgId,
    sourceType: dto.sourceType,
    targetType: dto.targetType,
    status: 'PENDING',
    totalItems: dto.sourceFiles?.length ?? 0,
    processedItems: 0,
    successfulItems: 0,
    failedItems: 0,
    sourceFiles: dto.sourceFiles?.map(f => ({
      ...f,
      status: 'PENDING' as const,
      draftsCreated: 0,
    })) ?? [],
    kbScanParams: dto.kbScanParams,
    draftsCreated: [],
    errors: [],
    createdAt: now,
    createdBy: userId,
  };

  const sk = createExtractionJobSK(dto.orgId, jobId);
  await createItem(EXTRACTION_JOB_PK, sk, job);

  return job;
};

export const getExtractionJobRecord = async (
  orgId: string,
  jobId: string
): Promise<ExtractionJob | null> => {
  const sk = createExtractionJobSK(orgId, jobId);
  return getItem<ExtractionJob>(EXTRACTION_JOB_PK, sk);
};

export const updateExtractionJobProgress = async (
  orgId: string,
  jobId: string,
  updates: Partial<Pick<ExtractionJob,
    'status' | 'processedItems' | 'successfulItems' | 'failedItems' |
    'draftsCreated' | 'errors' | 'startedAt' | 'completedAt' | 'sourceFiles'
  >>
): Promise<ExtractionJob> => {
  const sk = createExtractionJobSK(orgId, jobId);
  return updateItem<ExtractionJob>(EXTRACTION_JOB_PK, sk, updates);
};

// ================================
// Generic Draft Helpers
// ================================

/**
 * Get a draft record by type and ID
 */
export const getDraftRecord = async <T extends AnyDraft>(
  draftType: DraftType,
  orgId: string,
  draftId: string
): Promise<T | null> => {
  const config = DRAFT_CONFIGS[draftType];
  const sk = config.buildSK(orgId, draftId);
  return getItem<T>(config.pk, sk);
};

/**
 * List drafts by type with optional status filter
 */
export const listDraftRecords = async <T extends AnyDraft>(
  draftType: DraftType,
  orgId: string,
  status?: string,
  limit = 50
): Promise<T[]> => {
  const config = DRAFT_CONFIGS[draftType];
  const items = await queryBySkPrefix<T & { [PK_NAME]: string; [SK_NAME]: string }>(
    config.pk,
    `${orgId}#`
  );

  let drafts = items as T[];

  // Filter by status if provided
  if (status) {
    drafts = drafts.filter(d => (d as AnyDraft).draftStatus === status);
  }

  // Filter out expired drafts
  const now = new Date();
  drafts = drafts.filter(d => {
    const expiresAt = (d as AnyDraft).expiresAt;
    if (!expiresAt) return true;
    return new Date(expiresAt) > now;
  });

  // Sort by createdAt descending
  drafts.sort((a, b) =>
    new Date((b as AnyDraft).createdAt).getTime() - new Date((a as AnyDraft).createdAt).getTime()
  );

  return drafts.slice(0, limit);
};

/**
 * Delete a draft record
 */
export const deleteDraftRecord = async (
  draftType: DraftType,
  orgId: string,
  draftId: string
): Promise<void> => {
  const config = DRAFT_CONFIGS[draftType];
  const sk = config.buildSK(orgId, draftId);
  await deleteItem(config.pk, sk);
};

/**
 * Discard a draft (delete it)
 */
export const discardDraft = async (
  draftType: DraftType,
  orgId: string,
  draftId: string
): Promise<boolean> => {
  const draft = await getDraftRecord(draftType, orgId, draftId);
  if (!draft) return false;
  
  await deleteDraftRecord(draftType, orgId, draftId);
  return true;
};

// ================================
// Draft Creation Inputs
// ================================

export interface CreateDraftPastProjectInput {
  orgId: string;
  title: string;
  client: string;
  contractNumber?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  value?: number | null;
  description: string;
  technicalApproach?: string | null;
  achievements?: string[];
  performanceRating?: number | null;
  domain?: string | null;
  technologies?: string[];
  naicsCodes?: string[];
  contractType?: string | null;
  setAside?: string | null;
  teamSize?: number | null;
  durationMonths?: number | null;
  clientPOC?: {
    name?: string | null;
    title?: string | null;
    email?: string | null;
    phone?: string | null;
    organization?: string | null;
  } | null;
  extractionSource: ExtractionSource;
  fieldConfidence?: PastProjectFieldConfidence;
  duplicateWarning?: DuplicateWarning;
}

export interface LaborRateDuplicateWarning {
  isDuplicate: boolean;
  existingPosition?: string;
  existingBaseRate?: number;
  existingFullyLoadedRate?: number;
}

export interface CreateDraftLaborRateInput {
  orgId: string;
  position: string;
  baseRate: number;
  overhead?: number;
  ga?: number;
  profit?: number;
  fullyLoadedRate: number;
  effectiveDate?: string;
  expirationDate?: string;
  rateSource?: string;
  extractionSource: {
    sourceType: 'DIRECT_UPLOAD' | 'KB_EXTRACTION';
    sourceDocumentKey?: string;
    sourceDocumentName?: string;
    extractionJobId?: string;
    extractedAt: string;
    extractedBy: string;
  };
  fieldConfidence?: {
    position?: number;
    baseRate?: number;
    overall: number;
  };
  duplicateWarning?: LaborRateDuplicateWarning;
}

export interface CreateDraftBOMItemInput {
  orgId: string;
  name: string;
  description?: string;
  category: string;
  unitCost: number;
  unit?: string;
  quantity?: number;
  vendor?: string;
  partNumber?: string;
  extractionSource: {
    sourceType: 'DIRECT_UPLOAD' | 'KB_EXTRACTION';
    sourceDocumentKey?: string;
    sourceDocumentName?: string;
    extractionJobId?: string;
    extractedAt: string;
    extractedBy: string;
  };
  fieldConfidence?: {
    name?: number;
    unitCost?: number;
    category?: number;
    overall: number;
  };
}

// ================================
// Draft Creation Functions
// ================================

export const createDraftPastProjectRecord = async (
  input: CreateDraftPastProjectInput
): Promise<PastProjectDraft> => {
  const projectId = uuidv4();
  const now = nowIso();
  const config = DRAFT_CONFIGS.PAST_PERFORMANCE;
  const expiresAt = new Date(Date.now() + config.defaultExpireDays * 24 * 60 * 60 * 1000).toISOString();

  const draft: PastProjectDraft = {
    projectId,
    orgId: input.orgId,
    title: input.title,
    client: input.client,
    contractNumber: input.contractNumber ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    value: input.value ?? null,
    description: input.description,
    technicalApproach: input.technicalApproach ?? null,
    achievements: input.achievements ?? [],
    performanceRating: input.performanceRating ?? null,
    domain: input.domain ?? null,
    technologies: input.technologies ?? [],
    naicsCodes: input.naicsCodes ?? [],
    contractType: input.contractType ?? null,
    setAside: input.setAside ?? null,
    teamSize: input.teamSize ?? null,
    durationMonths: input.durationMonths ?? null,
    clientPOC: input.clientPOC ?? null,
    usageCount: 0,
    lastUsedAt: null,
    usedInBriefIds: [],
    freshnessStatus: 'ACTIVE',
    staleSince: null,
    staleReason: null,
    lastFreshnessCheck: null,
    reactivatedAt: null,
    reactivatedBy: null,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
    createdBy: input.extractionSource.extractedBy,
    draftStatus: 'DRAFT',
    extractionSource: input.extractionSource,
    fieldConfidence: input.fieldConfidence,
    duplicateWarning: input.duplicateWarning,
    expiresAt,
  };

  const sk = config.buildSK(input.orgId, projectId);
  await createItem(config.pk, sk, draft);

  return draft;
};

export const createDraftLaborRateRecord = async (
  input: CreateDraftLaborRateInput
): Promise<LaborRateDraft> => {
  const draftId = uuidv4();
  const now = nowIso();
  const config = DRAFT_CONFIGS.LABOR_RATE;
  const expiresAt = new Date(Date.now() + config.defaultExpireDays * 24 * 60 * 60 * 1000).toISOString();

  const draft: LaborRateDraft = {
    draftId,
    orgId: input.orgId,
    draftStatus: 'DRAFT',
    targetType: 'LABOR_RATE',
    position: input.position,
    baseRate: input.baseRate,
    overhead: input.overhead ?? 0,
    ga: input.ga ?? 0,
    profit: input.profit ?? 0,
    fullyLoadedRate: input.fullyLoadedRate,
    effectiveDate: input.effectiveDate,
    expirationDate: input.expirationDate,
    rateSource: input.rateSource,
    extractionSource: input.extractionSource,
    fieldConfidence: input.fieldConfidence,
    duplicateWarning: input.duplicateWarning,
    createdAt: now,
    expiresAt,
  };

  const sk = config.buildSK(input.orgId, draftId);
  await createItem(config.pk, sk, draft);

  return draft;
};

export const createDraftBOMItemRecord = async (
  input: CreateDraftBOMItemInput
): Promise<BOMItemDraft> => {
  const draftId = uuidv4();
  const now = nowIso();
  const config = DRAFT_CONFIGS.BOM_ITEM;
  const expiresAt = new Date(Date.now() + config.defaultExpireDays * 24 * 60 * 60 * 1000).toISOString();

  const draft: BOMItemDraft = {
    draftId,
    orgId: input.orgId,
    draftStatus: 'DRAFT',
    targetType: 'BOM_ITEM',
    name: input.name,
    description: input.description,
    category: input.category,
    unitCost: input.unitCost,
    unit: input.unit ?? 'each',
    quantity: input.quantity,
    vendor: input.vendor,
    partNumber: input.partNumber,
    extractionSource: input.extractionSource,
    fieldConfidence: input.fieldConfidence,
    createdAt: now,
    expiresAt,
  };

  const sk = config.buildSK(input.orgId, draftId);
  await createItem(config.pk, sk, draft);

  return draft;
};

// ================================
// Draft Confirmation Functions
// ================================

export const confirmDraftPastProject = async (
  orgId: string,
  draftId: string,
  userId: string,
  updates?: Partial<PastProjectDraft>
): Promise<PastProject | null> => {
  const draft = await getDraftRecord<PastProjectDraft>('PAST_PERFORMANCE', orgId, draftId);
  if (!draft) return null;

  const finalDraft = { ...draft, ...updates };

  const pastProject = await createPastProject(
    {
      orgId: finalDraft.orgId,
      title: finalDraft.title,
      client: finalDraft.client,
      clientPOC: finalDraft.clientPOC || undefined,
      contractNumber: finalDraft.contractNumber || undefined,
      startDate: finalDraft.startDate || undefined,
      endDate: finalDraft.endDate || undefined,
      value: finalDraft.value || undefined,
      description: finalDraft.description,
      technicalApproach: finalDraft.technicalApproach || undefined,
      achievements: finalDraft.achievements || [],
      performanceRating: finalDraft.performanceRating || undefined,
      domain: finalDraft.domain || undefined,
      technologies: finalDraft.technologies || [],
      naicsCodes: finalDraft.naicsCodes || [],
      contractType: finalDraft.contractType || undefined,
      setAside: finalDraft.setAside || undefined,
      teamSize: finalDraft.teamSize || undefined,
      durationMonths: finalDraft.durationMonths || undefined,
    },
    userId
  );

  await deleteDraftRecord('PAST_PERFORMANCE', orgId, draftId);
  return pastProject;
};

export const confirmDraftLaborRate = async (
  orgId: string,
  draftId: string,
  userId: string,
  updates?: Partial<LaborRateDraft>
): Promise<{ laborRateId: string } | null> => {
  const draft = await getDraftRecord<LaborRateDraft>('LABOR_RATE', orgId, draftId);
  if (!draft || draft.draftStatus !== 'DRAFT') return null;

  const finalDraft = { ...draft, ...updates };
  const laborRateId = uuidv4();
  const now = nowIso();

  // Use updateLaborRate (putItem) instead of createLaborRate (createItem)
  // to allow upsert behavior when a position with same name already exists
  await updateLaborRate({
    orgId: finalDraft.orgId,
    laborRateId,
    position: finalDraft.position,
    baseRate: finalDraft.baseRate,
    overhead: finalDraft.overhead ?? 0,
    ga: finalDraft.ga ?? 0,
    profit: finalDraft.profit ?? 0,
    fullyLoadedRate: finalDraft.fullyLoadedRate,
    effectiveDate: finalDraft.effectiveDate ?? now.split('T')[0],
    expirationDate: finalDraft.expirationDate,
    isActive: true,
    rateJustification: finalDraft.rateSource,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
  });

  await deleteDraftRecord('LABOR_RATE', orgId, draftId);
  return { laborRateId };
};

export const confirmDraftBOMItem = async (
  orgId: string,
  draftId: string,
  userId: string,
  updates?: Partial<BOMItemDraft>
): Promise<{ bomItemId: string } | null> => {
  const draft = await getDraftRecord<BOMItemDraft>('BOM_ITEM', orgId, draftId);
  if (!draft || draft.draftStatus !== 'DRAFT') return null;

  const finalDraft = { ...draft, ...updates };
  const bomItemId = uuidv4();
  const now = nowIso();
  
  const validCategories = ['HARDWARE', 'SOFTWARE_LICENSE', 'MATERIALS', 'SUBCONTRACTOR', 'TRAVEL', 'ODC'] as const;
  const category = validCategories.includes(finalDraft.category.toUpperCase() as typeof validCategories[number])
    ? (finalDraft.category.toUpperCase() as typeof validCategories[number])
    : 'ODC';
    
  await createBOMItem({
    orgId: finalDraft.orgId,
    bomItemId,
    name: finalDraft.name,
    description: finalDraft.description ?? '',
    category,
    unitCost: finalDraft.unitCost,
    unit: finalDraft.unit ?? 'each',
    vendor: finalDraft.vendor,
    partNumber: finalDraft.partNumber,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
    updatedBy: userId,
  });

  await deleteDraftRecord('BOM_ITEM', orgId, draftId);
  return { bomItemId };
};

// ================================
// Duplicate Detection Helper
// ================================

const stringSimilarity = (s1: string, s2: string): number => {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 1.0;

  const editDistance = (a: string, b: string): number => {
    const matrix: number[][] = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  };

  return (longer.length - editDistance(longer, shorter)) / longer.length;
};

export const checkDuplicatePastProject = async (
  _orgId: string,
  extracted: {
    title: string;
    client: string;
    contractNumber?: string | null;
    value?: number | null;
  },
  existingProjects: Array<{ projectId: string; title: string; client: string; contractNumber?: string | null; value?: number | null }>
): Promise<DuplicateWarning> => {
  for (const existing of existingProjects) {
    const matchedFields: string[] = [];

    if (extracted.contractNumber && existing.contractNumber) {
      const normalizedExtracted = extracted.contractNumber.replace(/[\s-]/g, '').toUpperCase();
      const normalizedExisting = existing.contractNumber.replace(/[\s-]/g, '').toUpperCase();

      if (normalizedExtracted === normalizedExisting) {
        return {
          isDuplicate: true,
          matchType: 'EXACT',
          existingProjectId: existing.projectId,
          existingProjectTitle: existing.title,
          similarity: 100,
          matchedFields: ['contractNumber'],
        };
      }
    }

    const titleSimilarity = stringSimilarity(
      extracted.title.toLowerCase(),
      existing.title.toLowerCase()
    );

    if (titleSimilarity > 0.9) matchedFields.push('title');

    const clientSimilarity = stringSimilarity(
      extracted.client.toLowerCase(),
      existing.client.toLowerCase()
    );

    if (clientSimilarity > 0.85) matchedFields.push('client');

    if (extracted.value && existing.value) {
      const valueDiff = Math.abs(extracted.value - existing.value) / existing.value;
      if (valueDiff < 0.05) matchedFields.push('value');
    }

    if (matchedFields.includes('title') && matchedFields.includes('client')) {
      return {
        isDuplicate: true,
        matchType: 'SIMILAR',
        existingProjectId: existing.projectId,
        existingProjectTitle: existing.title,
        similarity: Math.round((titleSimilarity + clientSimilarity) / 2 * 100),
        matchedFields,
      };
    }

    if (titleSimilarity > 0.95) {
      return {
        isDuplicate: true,
        matchType: 'SIMILAR',
        existingProjectId: existing.projectId,
        existingProjectTitle: existing.title,
        similarity: Math.round(titleSimilarity * 100),
        matchedFields: ['title'],
      };
    }
  }

  return {
    isDuplicate: false,
    matchType: 'NONE',
    matchedFields: [],
  };
};

/**
 * Check if a labor rate with the same position already exists
 * Returns warning info if duplicate found
 */
export const checkDuplicateLaborRate = (
  extractedPosition: string,
  existingRates: Array<{ position: string; baseRate: number; fullyLoadedRate: number }>
): LaborRateDuplicateWarning => {
  const normalizedExtracted = extractedPosition.toLowerCase().trim();
  
  for (const existing of existingRates) {
    const normalizedExisting = existing.position.toLowerCase().trim();
    
    // Exact match
    if (normalizedExtracted === normalizedExisting) {
      return {
        isDuplicate: true,
        existingPosition: existing.position,
        existingBaseRate: existing.baseRate,
        existingFullyLoadedRate: existing.fullyLoadedRate,
      };
    }
    
    // Fuzzy match - use string similarity for close matches
    const similarity = stringSimilarity(normalizedExtracted, normalizedExisting);
    if (similarity > 0.85) {
      return {
        isDuplicate: true,
        existingPosition: existing.position,
        existingBaseRate: existing.baseRate,
        existingFullyLoadedRate: existing.fullyLoadedRate,
      };
    }
  }
  
  return { isDuplicate: false };
};



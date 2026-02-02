import { z } from 'zod';

export const ContentSourceSchema = z.object({
  id: z.string(),
  fileName: z.string().optional(),
  pageNumber: z.union([z.string(), z.number()]).optional(),
  documentId: z.string().uuid().optional(),
  chunkKey: z.string().optional(),
  relevance: z.number().min(0).max(1).optional(),
  textContent: z.string().optional(),
});

export type ContentSource = z.infer<typeof ContentSourceSchema>;

export const ContentLibraryVersionSchema = z.object({
  version: z.number().int().min(1),
  text: z.string(),
  createdAt: z.string().datetime(),
  createdBy: z.string().uuid(),
  changeNotes: z.string().optional(),
});

export type ContentLibraryVersion = z.infer<typeof ContentLibraryVersionSchema>;

export const ApprovalStatusSchema = z.enum(['DRAFT', 'APPROVED', 'DEPRECATED']);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export const ContentLibraryItemSchema = z.object({
  id: z.string().uuid(),
  orgId: z.string().uuid(),
  kbId: z.string().uuid(),

  question: z.string().min(1),
  answer: z.string().min(1),
  category: z.string().min(1).max(100),
  tags: z.array(z.string()).max(20).default([]),
  description: z.string().max(500).optional(),
  sources: z.array(ContentSourceSchema).optional(),

  usageCount: z.number().int().nonnegative().default(0),
  lastUsedAt: z.string().datetime().nullable().optional(),
  usedInProjectIds: z.array(z.string().uuid()).max(100).default([]),

  currentVersion: z.number().int().min(1).default(1),
  versions: z.array(ContentLibraryVersionSchema).default([]),

  isArchived: z.boolean().default(false),
  archivedAt: z.string().datetime().nullable().optional(),

  confidenceScore: z.number().min(0).max(1).optional(),
  approvalStatus: ApprovalStatusSchema.default('DRAFT'),
  approvedBy: z.string().uuid().nullable().optional(),
  approvedAt: z.string().datetime().nullable().optional(),

  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  createdBy: z.string().uuid(),
  updatedBy: z.string().uuid().optional(),
});

export type ContentLibraryItem = z.infer<typeof ContentLibraryItemSchema>;

export const CreateContentLibraryItemDTOSchema = z.object({
  orgId: z.string().uuid(),
  kbId: z.string().uuid(),
  question: z.string().min(1, 'Question is required'),
  answer: z.string().min(1, 'Answer is required'),
  category: z.string().min(1).max(100),
  tags: z.array(z.string()).max(20).optional(),
  description: z.string().max(500).optional(),
  sources: z.array(ContentSourceSchema).optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
});

export type CreateContentLibraryItemDTO = z.infer<typeof CreateContentLibraryItemDTOSchema>;

export const UpdateContentLibraryItemDTOSchema = z.object({
  question: z.string().min(1).optional(),
  answer: z.string().min(1).optional(),
  category: z.string().min(1).max(100).optional(),
  tags: z.array(z.string()).max(20).optional(),
  description: z.string().max(500).optional(),
  sources: z.array(ContentSourceSchema).optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
  changeNotes: z.string().max(500).optional(),
});

export type UpdateContentLibraryItemDTO = z.infer<typeof UpdateContentLibraryItemDTOSchema>;

// Search/filter content library
export const SearchContentLibraryDTOSchema = z.object({
  orgId: z.string().uuid(),
  kbId: z.string().uuid(),
  query: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  approvalStatus: ApprovalStatusSchema.optional(),
  excludeArchived: z.boolean().default(true),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export type SearchContentLibraryDTO = z.infer<typeof SearchContentLibraryDTOSchema>;

// Approve content library item
export const ApproveContentLibraryItemDTOSchema = z.object({
  approvedBy: z.string().uuid(),
});

export type ApproveContentLibraryItemDTO = z.infer<typeof ApproveContentLibraryItemDTOSchema>;

// Track usage of content library item
export const TrackUsageDTOSchema = z.object({
  itemId: z.string().uuid(),
  projectId: z.string().uuid(),
});

export type TrackUsageDTO = z.infer<typeof TrackUsageDTOSchema>;

// Import from existing answer
export const ImportFromAnswerDTOSchema = z.object({
  orgId: z.string().uuid(),
  answerId: z.string().uuid(),
  questionId: z.string().uuid(),
  category: z.string().min(1).max(100),
  tags: z.array(z.string()).max(20).optional(),
});

export type ImportFromAnswerDTO = z.infer<typeof ImportFromAnswerDTOSchema>;

//
// ================================
// Response Types
// ================================
//

export const ContentLibraryListResponseSchema = z.object({
  items: z.array(ContentLibraryItemSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

export type ContentLibraryListResponse = z.infer<typeof ContentLibraryListResponseSchema>;

export const ContentLibraryCategoriesResponseSchema = z.object({
  categories: z.array(z.object({
    name: z.string(),
    count: z.number().int().nonnegative(),
  })),
});

export type ContentLibraryCategoriesResponse = z.infer<typeof ContentLibraryCategoriesResponseSchema>;

export const ContentLibraryTagsResponseSchema = z.object({
  tags: z.array(z.object({
    name: z.string(),
    count: z.number().int().nonnegative(),
  })),
});

export type ContentLibraryTagsResponse = z.infer<typeof ContentLibraryTagsResponseSchema>;

export const CONTENT_LIBRARY_PK = 'CONTENT_LIBRARY';

export function createContentLibrarySK(orgId: string, kbId: string, itemId: string): string {
  return `${orgId}#${kbId}#${itemId}`;
}

export function parseContentLibrarySK(sk: string): { orgId: string; itemId: string, kbId: string } | null {
  const parts = sk.split('#');
  if (parts.length !== 3) return null;
  return { orgId: parts[0], kbId: parts[1], itemId: parts[2] };
}
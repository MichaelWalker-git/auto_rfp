// lambda/schemas/content-library.test.ts
import {
  ContentLibraryItemSchema,
  CreateContentLibraryItemDTOSchema,
  UpdateContentLibraryItemDTOSchema,
  SearchContentLibraryDTOSchema,
  ApproveContentLibraryItemDTOSchema,
  TrackUsageDTOSchema,
  CONTENT_LIBRARY_PK,
  createContentLibrarySK,
  parseContentLibrarySK,
  ApprovalStatusSchema,
} from './content-library';

describe('Content Library Schema', () => {
  describe('ContentLibraryItemSchema', () => {
    const validItem = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      orgId: '550e8400-e29b-41d4-a716-446655440001',
      question: 'What is your company background?',
      answer: 'We are a leading provider of cloud solutions...',
      category: 'Company Background',
      tags: ['company', 'background', 'about-us'],
      description: 'Standard company background response',
      usageCount: 5,
      lastUsedAt: '2025-01-22T12:00:00Z',
      usedInProjectIds: ['550e8400-e29b-41d4-a716-446655440002'],
      currentVersion: 1,
      versions: [{
        version: 1,
        text: 'We are a leading provider of cloud solutions...',
        createdAt: '2025-01-01T00:00:00Z',
        createdBy: '550e8400-e29b-41d4-a716-446655440003',
      }],
      isArchived: false,
      approvalStatus: 'APPROVED',
      approvedBy: '550e8400-e29b-41d4-a716-446655440003',
      approvedAt: '2025-01-15T10:00:00Z',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-15T10:00:00Z',
      createdBy: '550e8400-e29b-41d4-a716-446655440003',
    };

    it('validates a valid content library item', () => {
      const result = ContentLibraryItemSchema.safeParse(validItem);
      expect(result.success).toBe(true);
    });

    it('requires question field', () => {
      const invalidItem = { ...validItem, question: '' };
      const result = ContentLibraryItemSchema.safeParse(invalidItem);
      expect(result.success).toBe(false);
    });

    it('requires answer field', () => {
      const invalidItem = { ...validItem, answer: '' };
      const result = ContentLibraryItemSchema.safeParse(invalidItem);
      expect(result.success).toBe(false);
    });

    it('requires valid UUID for id', () => {
      const invalidItem = { ...validItem, id: 'not-a-uuid' };
      const result = ContentLibraryItemSchema.safeParse(invalidItem);
      expect(result.success).toBe(false);
    });

    it('enforces category max length of 100', () => {
      const invalidItem = { ...validItem, category: 'a'.repeat(101) };
      const result = ContentLibraryItemSchema.safeParse(invalidItem);
      expect(result.success).toBe(false);
    });

    it('enforces tags max count of 20', () => {
      const invalidItem = {
        ...validItem,
        tags: Array(21).fill('tag')
      };
      const result = ContentLibraryItemSchema.safeParse(invalidItem);
      expect(result.success).toBe(false);
    });

    it('allows missing optional fields', () => {
      const minimalItem = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        orgId: '550e8400-e29b-41d4-a716-446655440001',
        question: 'What is your company background?',
        answer: 'We are a leading provider...',
        category: 'Company Background',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        createdBy: '550e8400-e29b-41d4-a716-446655440003',
      };
      const result = ContentLibraryItemSchema.safeParse(minimalItem);
      expect(result.success).toBe(true);
    });

    it('validates confidence score range 0-1', () => {
      const itemWithValidScore = { ...validItem, confidenceScore: 0.85 };
      expect(ContentLibraryItemSchema.safeParse(itemWithValidScore).success).toBe(true);

      const itemWithTooHighScore = { ...validItem, confidenceScore: 1.5 };
      expect(ContentLibraryItemSchema.safeParse(itemWithTooHighScore).success).toBe(false);

      const itemWithNegativeScore = { ...validItem, confidenceScore: -0.1 };
      expect(ContentLibraryItemSchema.safeParse(itemWithNegativeScore).success).toBe(false);
    });
  });

  describe('ApprovalStatusSchema', () => {
    it('accepts valid status values', () => {
      expect(ApprovalStatusSchema.safeParse('DRAFT').success).toBe(true);
      expect(ApprovalStatusSchema.safeParse('APPROVED').success).toBe(true);
      expect(ApprovalStatusSchema.safeParse('DEPRECATED').success).toBe(true);
    });

    it('rejects invalid status values', () => {
      expect(ApprovalStatusSchema.safeParse('PENDING').success).toBe(false);
      expect(ApprovalStatusSchema.safeParse('invalid').success).toBe(false);
    });
  });

  describe('CreateContentLibraryItemDTOSchema', () => {
    const validCreateDTO = {
      orgId: '550e8400-e29b-41d4-a716-446655440001',
      question: 'What is your company background?',
      answer: 'We are a leading provider of cloud solutions...',
      category: 'Company Background',
      tags: ['company', 'background'],
    };

    it('validates a valid create DTO', () => {
      const result = CreateContentLibraryItemDTOSchema.safeParse(validCreateDTO);
      expect(result.success).toBe(true);
    });

    it('requires orgId', () => {
      const { orgId, ...withoutOrgId } = validCreateDTO;
      const result = CreateContentLibraryItemDTOSchema.safeParse(withoutOrgId);
      expect(result.success).toBe(false);
    });

    it('requires question', () => {
      const { question, ...withoutQuestion } = validCreateDTO;
      const result = CreateContentLibraryItemDTOSchema.safeParse(withoutQuestion);
      expect(result.success).toBe(false);
    });

    it('requires answer', () => {
      const { answer, ...withoutAnswer } = validCreateDTO;
      const result = CreateContentLibraryItemDTOSchema.safeParse(withoutAnswer);
      expect(result.success).toBe(false);
    });

    it('requires category', () => {
      const { category, ...withoutCategory } = validCreateDTO;
      const result = CreateContentLibraryItemDTOSchema.safeParse(withoutCategory);
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateContentLibraryItemDTOSchema', () => {
    it('allows partial updates', () => {
      const partialUpdate = { answer: 'Updated answer text' };
      const result = UpdateContentLibraryItemDTOSchema.safeParse(partialUpdate);
      expect(result.success).toBe(true);
    });

    it('allows change notes for version tracking', () => {
      const updateWithNotes = {
        answer: 'Updated answer',
        changeNotes: 'Clarified technical requirements',
      };
      const result = UpdateContentLibraryItemDTOSchema.safeParse(updateWithNotes);
      expect(result.success).toBe(true);
    });

    it('enforces change notes max length', () => {
      const updateWithLongNotes = {
        answer: 'Updated',
        changeNotes: 'a'.repeat(501),
      };
      const result = UpdateContentLibraryItemDTOSchema.safeParse(updateWithLongNotes);
      expect(result.success).toBe(false);
    });
  });

  describe('SearchContentLibraryDTOSchema', () => {
    it('validates a valid search DTO', () => {
      const validSearch = {
        orgId: '550e8400-e29b-41d4-a716-446655440001',
        query: 'cloud solutions',
        category: 'Technical',
        limit: 10,
        offset: 0,
      };
      const result = SearchContentLibraryDTOSchema.safeParse(validSearch);
      expect(result.success).toBe(true);
    });

    it('requires orgId', () => {
      const searchWithoutOrg = { query: 'test' };
      const result = SearchContentLibraryDTOSchema.safeParse(searchWithoutOrg);
      expect(result.success).toBe(false);
    });

    it('applies default values for limit and offset', () => {
      const minimalSearch = {
        orgId: '550e8400-e29b-41d4-a716-446655440001',
      };
      const result = SearchContentLibraryDTOSchema.safeParse(minimalSearch);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.limit).toBe(20);
        expect(result.data.offset).toBe(0);
        expect(result.data.excludeArchived).toBe(true);
      }
    });

    it('enforces limit max of 100', () => {
      const searchWithHighLimit = {
        orgId: '550e8400-e29b-41d4-a716-446655440001',
        limit: 101,
      };
      const result = SearchContentLibraryDTOSchema.safeParse(searchWithHighLimit);
      expect(result.success).toBe(false);
    });
  });

  describe('ApproveContentLibraryItemDTOSchema', () => {
    it('validates a valid approve DTO', () => {
      const validApprove = {
        approvedBy: '550e8400-e29b-41d4-a716-446655440003',
      };
      const result = ApproveContentLibraryItemDTOSchema.safeParse(validApprove);
      expect(result.success).toBe(true);
    });

    it('requires valid UUID for approvedBy', () => {
      const invalidApprove = { approvedBy: 'not-a-uuid' };
      const result = ApproveContentLibraryItemDTOSchema.safeParse(invalidApprove);
      expect(result.success).toBe(false);
    });
  });

  describe('TrackUsageDTOSchema', () => {
    it('validates a valid track usage DTO', () => {
      const validTrack = {
        itemId: '550e8400-e29b-41d4-a716-446655440000',
        projectId: '550e8400-e29b-41d4-a716-446655440002',
      };
      const result = TrackUsageDTOSchema.safeParse(validTrack);
      expect(result.success).toBe(true);
    });

    it('requires both itemId and projectId', () => {
      const onlyItemId = { itemId: '550e8400-e29b-41d4-a716-446655440000' };
      const onlyProjectId = { projectId: '550e8400-e29b-41d4-a716-446655440002' };

      expect(TrackUsageDTOSchema.safeParse(onlyItemId).success).toBe(false);
      expect(TrackUsageDTOSchema.safeParse(onlyProjectId).success).toBe(false);
    });
  });

  describe('DynamoDB Key Helpers', () => {
    it('CONTENT_LIBRARY_PK is correct constant', () => {
      expect(CONTENT_LIBRARY_PK).toBe('CONTENT_LIBRARY');
    });

    it('createContentLibrarySK creates correct sort key', () => {
      const sk = createContentLibrarySK(
        '550e8400-e29b-41d4-a716-446655440001',
        '550e8400-e29b-41d4-a716-446655440000'
      );
      expect(sk).toBe('550e8400-e29b-41d4-a716-446655440001#550e8400-e29b-41d4-a716-446655440000');
    });

    it('parseContentLibrarySK parses valid sort key', () => {
      const sk = '550e8400-e29b-41d4-a716-446655440001#550e8400-e29b-41d4-a716-446655440000';
      const result = parseContentLibrarySK(sk);
      expect(result).toEqual({
        orgId: '550e8400-e29b-41d4-a716-446655440001',
        itemId: '550e8400-e29b-41d4-a716-446655440000',
      });
    });

    it('parseContentLibrarySK returns null for invalid sort key', () => {
      expect(parseContentLibrarySK('invalid')).toBeNull();
      expect(parseContentLibrarySK('too#many#parts')).toBeNull();
      expect(parseContentLibrarySK('')).toBeNull();
    });
  });
});

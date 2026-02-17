import { renderHook, waitFor, act } from '@testing-library/react';
import {
  useContentLibraryItems,
  useContentLibraryItem,
  useContentLibraryCategories,
  useContentLibraryTags,
  useCreateContentLibraryItem,
  ContentLibraryItem,
} from './use-content-library';
import { SWRConfig } from 'swr';
import React from 'react';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

/** Helper to create a mock Response with both json() and text() */
function mockResponse(data: unknown, ok = true, status = ok ? 200 : 500) {
  const body = JSON.stringify(data);
  return {
    ok,
    status,
    json: async () => data,
    text: async () => body,
  };
}

// Wrapper to clear SWR cache between tests
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
    {children}
  </SWRConfig>
);

describe('Content Library Hooks', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('useContentLibraryItems', () => {
    const mockItems: ContentLibraryItem[] = [
      {
        id: 'item-1',
        orgId: 'org-1',
        kbId: 'kb-1',
        question: 'What is your company?',
        answer: 'We are a tech company...',
        category: 'Company',
        tags: ['about', 'company'],
        usageCount: 5,
        usedInProjectIds: [],
        currentVersion: 1,
        versions: [],
        isArchived: false,
        approvalStatus: 'APPROVED',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        createdBy: 'user-1',
      },
    ];

    it('fetches content library items', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        items: mockItems,
        total: 1,
        limit: 20,
        offset: 0,
        hasMore: false,
      }));

      const { result } = renderHook(
        () => useContentLibraryItems({ orgId: 'org-1', kbId: 'kb-1' }),
        { wrapper }
      );

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].question).toBe('What is your company?');
      expect(result.current.total).toBe(1);
    });

    it('returns empty array when params is null', () => {
      const { result } = renderHook(
        () => useContentLibraryItems(null),
        { wrapper }
      );

      expect(result.current.items).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });

    it('handles fetch errors', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ error: 'Server error' }, false, 500));

      const { result } = renderHook(
        () => useContentLibraryItems({ orgId: 'org-1', kbId: 'kb-1' }),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });

      expect(result.current.error).toBeTruthy();
    });

    it('builds query params correctly', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        items: [],
        total: 0,
        limit: 10,
        offset: 5,
        hasMore: false,
      }));

      renderHook(
        () =>
          useContentLibraryItems({
            orgId: 'org-1',
            kbId: 'kb-1',
            query: 'cloud',
            category: 'Technical',
            tags: ['aws', 'azure'],
            approvalStatus: 'APPROVED',
            limit: 10,
            offset: 5,
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalled();
      });

      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('orgId=org-1');
      expect(calledUrl).toContain('kbId=kb-1');
      expect(calledUrl).toContain('query=cloud');
      expect(calledUrl).toContain('category=Technical');
      expect(calledUrl).toContain('tags=aws%2Cazure');
      expect(calledUrl).toContain('approvalStatus=APPROVED');
      expect(calledUrl).toContain('limit=10');
      expect(calledUrl).toContain('offset=5');
    });
  });

  describe('useContentLibraryItem', () => {
    const mockItem: ContentLibraryItem = {
      id: 'item-1',
      orgId: 'org-1',
      kbId: 'kb-1',
      question: 'What is your company?',
      answer: 'We are a tech company...',
      category: 'Company',
      tags: ['about'],
      usageCount: 0,
      usedInProjectIds: [],
      currentVersion: 1,
      versions: [],
      isArchived: false,
      approvalStatus: 'DRAFT',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
      createdBy: 'user-1',
    };

    it('fetches a single item', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockItem));

      const { result } = renderHook(
        () => useContentLibraryItem('org-1', 'item-1'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.item?.id).toBe('item-1');
      expect(result.current.item?.question).toBe('What is your company?');
    });

    it('does not fetch when orgId is null', () => {
      const { result } = renderHook(
        () => useContentLibraryItem(null, 'item-1'),
        { wrapper }
      );

      expect(result.current.item).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not fetch when itemId is null', () => {
      const { result } = renderHook(
        () => useContentLibraryItem('org-1', null),
        { wrapper }
      );

      expect(result.current.item).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('useContentLibraryCategories', () => {
    it('fetches categories', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([
        { name: 'Technical', count: 10 },
        { name: 'Company', count: 5 },
      ]));

      const { result } = renderHook(
        () => useContentLibraryCategories('org-1'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.categories).toHaveLength(2);
      expect(result.current.categories[0].name).toBe('Technical');
      expect(result.current.categories[0].count).toBe(10);
    });

    it('returns empty array when orgId is null', () => {
      const { result } = renderHook(
        () => useContentLibraryCategories(null),
        { wrapper }
      );

      expect(result.current.categories).toEqual([]);
    });
  });

  describe('useContentLibraryTags', () => {
    it('fetches tags', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({
        tags: [
          { name: 'cloud', count: 15 },
          { name: 'security', count: 8 },
        ],
      }));

      const { result } = renderHook(
        () => useContentLibraryTags('org-1'),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.tags).toHaveLength(2);
      expect(result.current.tags[0].name).toBe('cloud');
    });
  });

  describe('useCreateContentLibraryItem', () => {
    it('creates a new item', async () => {
      const newItem: ContentLibraryItem = {
        id: 'new-item',
        orgId: 'org-1',
        kbId: 'kb-1',
        question: 'New question',
        answer: 'New answer',
        category: 'Technical',
        tags: [],
        usageCount: 0,
        usedInProjectIds: [],
        currentVersion: 1,
        versions: [],
        isArchived: false,
        approvalStatus: 'DRAFT',
        createdAt: '2025-01-22T00:00:00Z',
        updatedAt: '2025-01-22T00:00:00Z',
        createdBy: 'user-1',
      };

      mockFetch.mockResolvedValueOnce(mockResponse(newItem));

      const { result } = renderHook(() => useCreateContentLibraryItem(), { wrapper });

      let created: ContentLibraryItem | undefined;
      await act(async () => {
        created = await result.current.create({
          orgId: 'org-1',
          kbId: 'kb-1',
          question: 'New question',
          answer: 'New answer',
          category: 'Technical',
        });
      });

      expect(created?.id).toBe('new-item');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/content-library/create-content-library'),
        expect.objectContaining({
          method: 'POST',
          body: expect.any(String),
        })
      );
    });

    it('handles creation errors', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ error: 'Validation failed' }, false));

      const { result } = renderHook(() => useCreateContentLibraryItem(), { wrapper });

      await act(async () => {
        await expect(
          result.current.create({
            orgId: 'org-1',
            kbId: 'kb-1',
            question: '',
            answer: '',
            category: '',
          })
        ).rejects.toThrow('Validation failed');
      });
    });
  });
});

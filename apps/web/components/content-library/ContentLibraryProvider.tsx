'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  useContentLibraryItems,
  useContentLibraryCategories,
  type ContentLibraryItem,
  type ApprovalStatus,
} from '@/lib/hooks/use-content-library';

interface ContentLibraryContextValue {
  items: ContentLibraryItem[];
  total: number;
  categories: Array<{ name: string; count: number }>;
  isLoading: boolean;
  mutate: () => void;
}

const ContentLibraryContext = createContext<ContentLibraryContextValue | undefined>(undefined);

interface ContentLibraryProviderProps {
  children: ReactNode;
  orgId: string;
  kbId: string;
}

const ITEMS_PER_PAGE = 20;

export function ContentLibraryProvider({ children, orgId, kbId }: ContentLibraryProviderProps) {
  const searchParams = useSearchParams();
  
  // Get URL parameters
  const search = searchParams.get('search') || '';
  const category = searchParams.get('category') || undefined;
  const status = searchParams.get('status') as ApprovalStatus | undefined;
  const page = parseInt(searchParams.get('page') || '1', 10);
  const offset = (page - 1) * ITEMS_PER_PAGE;

  // Fetch items with URL parameters
  const {
    items = [],
    total = 0,
    isLoading: itemsLoading,
    mutate: mutateItems,
  } = useContentLibraryItems({
    orgId,
    kbId,
    query: search || undefined,
    category: category,
    approvalStatus: status,
    excludeArchived: true,
    limit: ITEMS_PER_PAGE,
    offset: offset,
  });

  // Fetch categories
  const { categories = [], isLoading: categoriesLoading } = useContentLibraryCategories(orgId);

  console.log('ContentLibraryProvider data:', {
    items: items.length,
    total,
    categories: categories.length,
    isLoading: itemsLoading || categoriesLoading,
    params: { search, category, status, page, offset }
  });

  const value: ContentLibraryContextValue = {
    items,
    total,
    categories,
    isLoading: itemsLoading || categoriesLoading,
    mutate: mutateItems,
  };

  return (
    <ContentLibraryContext.Provider value={value}>
      {children}
    </ContentLibraryContext.Provider>
  );
}

export function useContentLibraryContext() {
  const context = useContext(ContentLibraryContext);
  if (!context) {
    throw new Error('useContentLibraryContext must be used within ContentLibraryProvider');
  }
  return context;
}

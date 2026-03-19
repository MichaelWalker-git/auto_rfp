'use client';

import { useState, useEffect, useCallback } from 'react';

export type GridColumns = 1 | 2 | 4;

const STORAGE_KEY = 'opportunities-grid-columns';
const DEFAULT_COLUMNS: GridColumns = 4;

/**
 * Hook for managing grid view preference with localStorage persistence.
 * Returns the current column count and a setter function.
 */
export const useGridView = () => {
  const [columns, setColumnsState] = useState<GridColumns>(DEFAULT_COLUMNS);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load preference from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = parseInt(stored, 10);
        if (parsed === 1 || parsed === 2 || parsed === 4) {
          setColumnsState(parsed as GridColumns);
        }
      }
    } catch {
      // localStorage not available, use default
    }
    setIsLoaded(true);
  }, []);

  // Set columns and persist to localStorage
  const setColumns = useCallback((value: GridColumns) => {
    setColumnsState(value);
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // localStorage not available
    }
  }, []);

  return {
    columns,
    setColumns,
    isLoaded,
  };
};

/**
 * Returns Tailwind CSS grid classes based on the column count.
 * - 1 column: single column on all screens
 * - 2 columns: 1 col on mobile, 2 cols on sm+
 * - 4 columns: responsive 1 -> 2 -> 3 -> 4 columns
 */
export const getGridClasses = (columns: GridColumns): string => {
  switch (columns) {
    case 1:
      return 'grid grid-cols-1 gap-3';
    case 2:
      return 'grid grid-cols-1 sm:grid-cols-2 gap-3';
    case 4:
    default:
      return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3';
  }
};

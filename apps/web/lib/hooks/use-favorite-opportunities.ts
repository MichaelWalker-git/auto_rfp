'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'auto-rfp-favorite-opportunities';

/**
 * Hook to manage favorite opportunities using localStorage
 * Favorites are stored as an array of opportunity IDs (oppId)
 */
export const useFavoriteOpportunities = () => {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [isLoaded, setIsLoaded] = useState(false);

  // Load favorites from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        setFavorites(new Set(parsed));
      }
    } catch (error) {
      console.error('Failed to load favorite opportunities:', error);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // Save favorites to localStorage whenever they change
  const saveFavorites = useCallback((newFavorites: Set<string>) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(newFavorites)));
      setFavorites(newFavorites);
    } catch (error) {
      console.error('Failed to save favorite opportunities:', error);
    }
  }, []);

  // Toggle an opportunity's favorite status
  const toggleFavorite = useCallback(
    (oppId: string) => {
      const newFavorites = new Set(favorites);
      if (newFavorites.has(oppId)) {
        newFavorites.delete(oppId);
      } else {
        newFavorites.add(oppId);
      }
      saveFavorites(newFavorites);
    },
    [favorites, saveFavorites],
  );

  // Check if an opportunity is favorited
  const isFavorite = useCallback(
    (oppId: string): boolean => {
      return favorites.has(oppId);
    },
    [favorites],
  );

  return {
    favorites,
    isFavorite,
    toggleFavorite,
    isLoaded,
  };
};

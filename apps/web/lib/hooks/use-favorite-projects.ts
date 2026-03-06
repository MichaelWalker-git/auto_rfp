'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'auto-rfp-favorite-projects';

/**
 * Hook to manage favorite projects using localStorage
 * Favorites are stored as an array of project IDs
 */
export const useFavoriteProjects = () => {
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
      console.error('Failed to load favorite projects:', error);
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
      console.error('Failed to save favorite projects:', error);
    }
  }, []);

  // Toggle a project's favorite status
  const toggleFavorite = useCallback(
    (projectId: string) => {
      const newFavorites = new Set(favorites);
      if (newFavorites.has(projectId)) {
        newFavorites.delete(projectId);
      } else {
        newFavorites.add(projectId);
      }
      saveFavorites(newFavorites);
    },
    [favorites, saveFavorites],
  );

  // Check if a project is favorited
  const isFavorite = useCallback(
    (projectId: string): boolean => {
      return favorites.has(projectId);
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

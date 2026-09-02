'use client';

import { useCallback, useState } from 'react';
import {
  PageFurnitureSchema,
  TemplateFurnitureSchema,
  type FurnitureSectionOverride,
  type PageFurniture,
  type PageFurnitureAlignment,
  type TemplateFurniture,
} from '@auto-rfp/core';

/** An empty-but-valid furniture config, used as the starting point in the editor. */
const emptyFurniture = (): TemplateFurniture => TemplateFurnitureSchema.parse({});

const emptyPart = (): PageFurniture => PageFurnitureSchema.parse({});

export interface UseTemplateFurnitureResult {
  furniture: TemplateFurniture;
  /** Replace the whole config — used when loading an existing template. */
  setFurniture: (next: TemplateFurniture | undefined) => void;
  updateHeader: (patch: Partial<PageFurniture>) => void;
  updateFooter: (patch: Partial<PageFurniture>) => void;
  setSectionOverride: (sectionIndex: number, patch: Partial<Omit<FurnitureSectionOverride, 'sectionIndex'>>) => void;
  /** Effective visibility for a section, accounting for defaults and overrides. */
  sectionVisibility: (sectionIndex: number) => { showHeader: boolean; showFooter: boolean };
  /**
   * The value to send to the API: `undefined` when nothing is configured, so a
   * template without a header/footer stays without one rather than gaining an
   * empty config.
   */
  toPayload: () => TemplateFurniture | undefined;
}

/**
 * Owns header/footer state for the template editor.
 *
 * Kept in a hook rather than the page so the create and edit pages share exactly
 * one implementation of the defaulting and override rules.
 */
export const useTemplateFurniture = (
  initial?: TemplateFurniture,
): UseTemplateFurnitureResult => {
  const [furniture, setFurnitureState] = useState<TemplateFurniture>(initial ?? emptyFurniture());

  const setFurniture = useCallback((next: TemplateFurniture | undefined) => {
    setFurnitureState(next ?? emptyFurniture());
  }, []);

  const updateHeader = useCallback((patch: Partial<PageFurniture>) => {
    setFurnitureState((prev) => ({ ...prev, header: { ...prev.header, ...patch } }));
  }, []);

  const updateFooter = useCallback((patch: Partial<PageFurniture>) => {
    setFurnitureState((prev) => ({ ...prev, footer: { ...prev.footer, ...patch } }));
  }, []);

  const setSectionOverride = useCallback((
    sectionIndex: number,
    patch: Partial<Omit<FurnitureSectionOverride, 'sectionIndex'>>,
  ) => {
    setFurnitureState((prev) => {
      const existing = prev.sectionOverrides.find((o) => o.sectionIndex === sectionIndex);
      const merged: FurnitureSectionOverride = { ...(existing ?? { sectionIndex }), ...patch };

      // Drop an override that no longer differs from the default, so the export
      // can keep using its cheaper single-section path.
      const isRedundant = merged.showHeader !== false && merged.showFooter !== false;
      const others = prev.sectionOverrides.filter((o) => o.sectionIndex !== sectionIndex);

      return {
        ...prev,
        sectionOverrides: isRedundant
          ? others
          : [...others, merged].sort((a, b) => a.sectionIndex - b.sectionIndex),
      };
    });
  }, []);

  const sectionVisibility = useCallback((sectionIndex: number) => {
    const override = furniture.sectionOverrides.find((o) => o.sectionIndex === sectionIndex);
    return {
      showHeader: override?.showHeader ?? true,
      showFooter: override?.showFooter ?? true,
    };
  }, [furniture]);

  const toPayload = useCallback((): TemplateFurniture | undefined => {
    const hasHeader = furniture.header.html.trim().length > 0;
    const hasFooter = furniture.footer.html.trim().length > 0;
    if (!hasHeader && !hasFooter) return undefined;
    return furniture;
  }, [furniture]);

  return {
    furniture,
    setFurniture,
    updateHeader,
    updateFooter,
    setSectionOverride,
    sectionVisibility,
    toPayload,
  };
};

export { emptyFurniture, emptyPart };
export type { PageFurnitureAlignment };

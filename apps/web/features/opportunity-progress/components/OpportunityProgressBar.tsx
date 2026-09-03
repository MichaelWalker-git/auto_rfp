'use client';

import type { NavigationDescriptor } from '../lib/types';

/** Selects a tab given its stable key (the `?tab=` setter). */
export type SelectTab = (tabKey: string) => void;

/**
 * Activates a step's navigation descriptor. The tabbed layout (ADR 0001) replaced
 * the standalone progress bar: a step now navigates by selecting the tab that owns
 * it (`{ kind: 'route' }`, `href` = the tab key) via the `?tab=` state, instead of
 * smooth-scrolling to a section anchor. The legacy `anchor` branch is retained so
 * the descriptor union stays total, but no step emits one any more.
 */
export const navigateToStep = (nav: NavigationDescriptor, selectTab: SelectTab): void => {
  if (nav.kind === 'route') {
    selectTab(nav.href);
    return;
  }
  // Legacy anchor scroll — no live step uses this after the tab reorg.
  const el = typeof document !== 'undefined' ? document.getElementById(nav.sectionId) : null;
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

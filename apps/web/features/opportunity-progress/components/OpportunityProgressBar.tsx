'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useOpportunityProgress } from '../hooks/useOpportunityProgress';
import { ProgressBarUI } from './ProgressBarUI';
import type { NavigationDescriptor } from '../lib/types';

/** Scroll distance (px) past which the pinned bar condenses. */
const CONDENSE_THRESHOLD = 160;

/** Walk up from `el` to the nearest scrollable ancestor (overflow-y auto/scroll),
 *  falling back to the window. The page scrolls inside the layout's `<main>`, not
 *  the window, so condensing must key off that element's scroll position. */
const findScrollParent = (el: HTMLElement | null): HTMLElement | Window => {
  let node = el?.parentElement ?? null;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return window;
};

const scrollTopOf = (target: HTMLElement | Window): number =>
  target instanceof Window ? target.scrollY : target.scrollTop;

const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
};

/** Activates a step's navigation descriptor. Today every descriptor is an anchor
 *  (smooth-scroll to a page section); a future `route` descriptor would push a route. */
export const navigateToStep = (nav: NavigationDescriptor) => {
  if (nav.kind === 'anchor') {
    const el = typeof document !== 'undefined' ? document.getElementById(nav.sectionId) : null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

/**
 * Host for the opportunity progress bar. Pins to the top of the viewport, condenses
 * on scroll, and renders the mobile variant on small screens. Data + status come
 * entirely from `useOpportunityProgress`; navigation is a generic descriptor action.
 */
export const OpportunityProgressBar = () => {
  const { steps, isLoading } = useOpportunityProgress();
  const isMobile = useMediaQuery('(max-width: 640px)');
  const [condensed, setCondensed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const scrollTarget = findScrollParent(containerRef.current);
    const onScroll = () => setCondensed(scrollTopOf(scrollTarget) > CONDENSE_THRESHOLD);
    onScroll();
    scrollTarget.addEventListener('scroll', onScroll, { passive: true });
    return () => scrollTarget.removeEventListener('scroll', onScroll);
  }, []);

  const handleNavigate = useCallback((nav: NavigationDescriptor) => navigateToStep(nav), []);

  const variant = isMobile ? 'mobile' : condensed ? 'condensed' : 'full';

  return (
    <div
      ref={containerRef}
      className={cn(
        'sticky top-0 z-30 -mx-1 border-b border-transparent bg-background/95 px-1 backdrop-blur transition-shadow',
        condensed && !isMobile && 'border-border shadow-sm',
      )}
    >
      <ProgressBarUI steps={steps} isLoading={isLoading} variant={variant} onNavigate={handleNavigate} />
    </div>
  );
};

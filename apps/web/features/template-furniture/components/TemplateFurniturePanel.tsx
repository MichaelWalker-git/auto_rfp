'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { deriveFurnitureSections } from '../lib/sections';
import type { UseTemplateFurnitureResult } from '../hooks/useTemplateFurniture';
import { FurnitureEditor } from './FurnitureEditor';
import { FurnitureSectionToggles } from './FurnitureSectionToggles';

/**
 * A compact, text-only summary of a band, shown on the collapsed group header.
 *
 * Replaces an `On`/`Off` badge, which was ambiguous: a user saw "Off" beside a
 * ticked "Enable header" checkbox and reasonably went looking for a switch. Showing
 * the actual content answers "is there a header, and what is it?" in one glance.
 */
const bandSummary = (html: string): string => {
  const text = html
    .replace(/<img[^>]*>/gi, '[image]')
    .replace(/\{\{(\w+)\}\}/g, (_m, t: string) => `‹${String(t).replace(/_/g, ' ')}›`)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 28 ? `${text.slice(0, 28)}…` : text;
};

interface TemplateFurniturePanelProps {
  /** State from `useTemplateFurniture`. */
  furnitureState: UseTemplateFurnitureResult;
  /** Template body HTML — page breaks in it define the sections. */
  bodyHtml: string;
  disabled?: boolean;
  onUploadImage?: (file: File) => Promise<string>;
}

/**
 * One collapsible group, styled to match `MacroInsertionBar`'s groups exactly
 * (`components/templates/MacroInsertionBar.tsx:98-146`) so the two sidebar panels
 * read as a single system. Hand-rolled `useState` rather than the shadcn
 * `Collapsible` primitive, because that is what MacroInsertionBar does.
 */
const FurnitureGroup = ({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** Content summary shown while collapsed, so state is legible without expanding. */
  badge?: { label: string; tone: 'on' | 'off' };
  defaultOpen?: boolean;
  children: React.ReactNode;
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span>{title}</span>
          {badge && (
            <span
              className={cn(
                'max-w-[10rem] truncate rounded px-1.5 py-0.5 text-[10px] font-medium',
                badge.tone === 'on'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {badge.label}
            </span>
          )}
        </span>
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      {isOpen && <div className="border-t border-border p-3 space-y-3">{children}</div>}
    </div>
  );
};

/**
 * Header & footer configuration panel for the template editor.
 *
 * Presentation only: all state lives in `useTemplateFurniture`, so the create and
 * edit pages behave identically.
 */
export const TemplateFurniturePanel = ({
  furnitureState,
  bodyHtml,
  disabled = false,
  onUploadImage,
}: TemplateFurniturePanelProps) => {
  const { furniture, updateHeader, updateFooter, setSectionOverride, sectionVisibility } = furnitureState;

  const sections = useMemo(() => deriveFurnitureSections(bodyHtml), [bodyHtml]);

  const hasHeader = furniture.header.enabled && furniture.header.html.trim().length > 0;
  const hasFooter = furniture.footer.enabled && furniture.footer.html.trim().length > 0;

  // Count only overrides that actually suppress something — a show:true override
  // matches the default and is dropped by the hook.
  const overrideCount = furniture.sectionOverrides.length;

  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold text-foreground">Header &amp; Footer</div>

      <div className="space-y-1.5">
        <FurnitureGroup
          title="Header"
          defaultOpen
          badge={
            hasHeader
              ? { label: bandSummary(furniture.header.html), tone: 'on' }
              : { label: 'empty', tone: 'off' }
          }
        >
          <FurnitureEditor
            kind="header"
            value={furniture.header}
            onChange={updateHeader}
            disabled={disabled}
            onUploadImage={onUploadImage}
          />
        </FurnitureGroup>

        <FurnitureGroup
          title="Footer"
          badge={
            hasFooter
              ? { label: bandSummary(furniture.footer.html), tone: 'on' }
              : { label: 'empty', tone: 'off' }
          }
        >
          <FurnitureEditor
            kind="footer"
            value={furniture.footer}
            onChange={updateFooter}
            disabled={disabled}
            onUploadImage={onUploadImage}
          />
        </FurnitureGroup>

        {/*
          Only offered once a page break has created a second section. With one
          section there is nothing to vary, so the group would open onto an empty
          box — previously papered over with an explanatory paragraph.
        */}
        {sections.length > 1 && (
          <FurnitureGroup
            title="Per-Section Visibility"
            badge={
              overrideCount
                ? { label: `${overrideCount} override${overrideCount === 1 ? '' : 's'}`, tone: 'on' }
                : undefined
            }
          >
            <FurnitureSectionToggles
              sections={sections}
              visibility={sectionVisibility}
              onChange={setSectionOverride}
              disabled={disabled}
              hasHeader={hasHeader}
              hasFooter={hasFooter}
            />
          </FurnitureGroup>
        )}
      </div>
    </div>
  );
};

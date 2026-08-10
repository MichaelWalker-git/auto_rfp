'use client';

import { useMemo } from 'react';
import { PanelTop, PanelBottom } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { deriveFurnitureSections } from '../lib/sections';
import type { UseTemplateFurnitureResult } from '../hooks/useTemplateFurniture';
import { FurnitureEditor } from './FurnitureEditor';
import { FurnitureSectionToggles } from './FurnitureSectionToggles';

interface TemplateFurniturePanelProps {
  /** State from `useTemplateFurniture`. */
  furnitureState: UseTemplateFurnitureResult;
  /** Template body HTML — page breaks in it define the sections. */
  bodyHtml: string;
  disabled?: boolean;
  onUploadImage?: (file: File) => Promise<string>;
}

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

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Header &amp; Footer</CardTitle>
        <p className="text-xs text-slate-500">
          Applied to every page of generated PDF, Word, and HTML output unless a
          section is switched off below.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        <section className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <PanelTop className="h-3.5 w-3.5" />
            Header
          </div>
          <FurnitureEditor
            kind="header"
            value={furniture.header}
            onChange={updateHeader}
            disabled={disabled}
            onUploadImage={onUploadImage}
          />
        </section>

        <Separator />

        <section className="space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <PanelBottom className="h-3.5 w-3.5" />
            Footer
          </div>
          <FurnitureEditor
            kind="footer"
            value={furniture.footer}
            onChange={updateFooter}
            disabled={disabled}
            onUploadImage={onUploadImage}
          />
        </section>

        <Separator />

        <section className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Per-section visibility
          </div>
          <FurnitureSectionToggles
            sections={sections}
            visibility={sectionVisibility}
            onChange={setSectionOverride}
            disabled={disabled}
            hasHeader={hasHeader}
            hasFooter={hasFooter}
          />
        </section>
      </CardContent>
    </Card>
  );
};

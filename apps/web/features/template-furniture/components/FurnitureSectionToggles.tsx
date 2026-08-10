'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { FurnitureSection } from '../lib/sections';

interface FurnitureSectionTogglesProps {
  sections: FurnitureSection[];
  visibility: (sectionIndex: number) => { showHeader: boolean; showFooter: boolean };
  onChange: (sectionIndex: number, patch: { showHeader?: boolean; showFooter?: boolean }) => void;
  disabled?: boolean;
  hasHeader: boolean;
  hasFooter: boolean;
}

/**
 * Per-section header/footer visibility toggles.
 *
 * Sections are page-break-delimited groups, not physical pages: page count only
 * exists after pagination, and Word models header/footer per section. This is what
 * makes "no header on the cover page" expressible in both PDF and DOCX.
 */
export const FurnitureSectionToggles = ({
  sections,
  visibility,
  onChange,
  disabled = false,
  hasHeader,
  hasFooter,
}: FurnitureSectionTogglesProps) => {
  if (sections.length <= 1) {
    return (
      <p className="text-xs text-slate-500">
        Insert a page break in the template to control the header and footer separately
        for each part of the document (for example, to hide them on a cover page).
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        <span>Section</span>
        <span>Header</span>
        <span>Footer</span>
      </div>

      {sections.map((section) => {
        const v = visibility(section.index);
        return (
          <div
            key={section.index}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-t border-slate-100 py-1.5"
          >
            <span className="truncate text-sm text-slate-700" title={section.label}>
              <span className="text-slate-400 mr-1.5">{section.index + 1}.</span>
              {section.label}
            </span>

            <Checkbox
              checked={v.showHeader}
              onCheckedChange={(checked) => onChange(section.index, { showHeader: checked === true })}
              disabled={disabled || !hasHeader}
              aria-label={`Show header on section ${section.index + 1}`}
            />
            <Checkbox
              checked={v.showFooter}
              onCheckedChange={(checked) => onChange(section.index, { showFooter: checked === true })}
              disabled={disabled || !hasFooter}
              aria-label={`Show footer on section ${section.index + 1}`}
            />
          </div>
        );
      })}

      {(!hasHeader || !hasFooter) && (
        <p className="pt-1 text-xs text-slate-500">
          {!hasHeader && !hasFooter
            ? 'Add header or footer content above to enable these toggles.'
            : !hasHeader
              ? 'Add header content above to enable the header toggles.'
              : 'Add footer content above to enable the footer toggles.'}
        </p>
      )}
    </div>
  );
};

/** Re-exported so pages can type section arrays without reaching into lib/. */
export type { FurnitureSection };

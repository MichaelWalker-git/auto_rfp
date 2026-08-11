'use client';

import { Checkbox } from '@/components/ui/checkbox';
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
  // Toggles are meaningless without a second section to differ from, and the panel
  // hides the whole group in that case, so render nothing rather than an empty box.
  if (sections.length <= 1) return null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>Section</span>
        <span>Header</span>
        <span>Footer</span>
      </div>

      {sections.map((section) => {
        const v = visibility(section.index);
        return (
          <div
            key={section.index}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-t border-border py-1.5"
          >
            <span className="truncate text-sm text-foreground" title={section.label}>
              <span className="text-muted-foreground mr-1.5">{section.index + 1}.</span>
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
        <p className="pt-1 text-xs text-muted-foreground">
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

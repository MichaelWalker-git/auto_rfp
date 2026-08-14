'use client';

import { FileText, History } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type FormSidebarTab = 'fields' | 'history';

interface FormSidebarTabsProps {
  value: FormSidebarTab;
  onChange: (tab: FormSidebarTab) => void;
}

/**
 * Segmented control for a required-form editor's right sidebar — switches its
 * body between the field list and version history. Mirrors the RFP document
 * editor's "AI Chat / History / Review" segmented control so forms and documents
 * present version history the same way (a tab in the existing sidebar, not a
 * separate overlay).
 *
 * Note: like its sibling panels (FormVersionHistory / QuestionnaireVersionHistory),
 * the form editor pins this sidebar to a LIGHT surface in both themes, so the
 * control uses explicit gray-scale colors rather than theme tokens (and has no
 * `dark:` variants) — otherwise the text/track would render near-white and vanish
 * in dark mode.
 */
export const FormSidebarTabs = ({ value, onChange }: FormSidebarTabsProps) => {
  const tab = (id: FormSidebarTab, label: string, Icon: typeof FileText) => (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onChange(id)}
      // Explicit gray-scale (see component note) preserved over the ghost variant
      // via tailwind-merge.
      className={cn(
        'h-auto flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-all',
        value === id
          ? 'bg-white text-gray-900 shadow-sm hover:bg-white'
          : 'text-gray-500 hover:text-gray-800 hover:bg-transparent',
      )}
      aria-pressed={value === id}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Button>
  );

  return (
    // Light track in both themes (see component note) — explicit gray, no dark:.
    <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
      {tab('fields', 'Fields', FileText)}
      {tab('history', 'History', History)}
    </div>
  );
};

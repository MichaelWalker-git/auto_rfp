'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MacroInsertionBarProps {
  onInsert: (key: string) => void;
  disabled?: boolean;
  hideTitle?: boolean;
}

interface MacroItem {
  key: string;
  label: string;
  description: string;
}

interface MacroGroup {
  title: string;
  items: MacroItem[];
  defaultOpen?: boolean;
}

const MACRO_GROUPS: MacroGroup[] = [
  {
    title: 'General',
    defaultOpen: true,
    items: [
      { key: 'TODAY', label: 'Today', description: "Today's date (YYYY-MM-DD)" },
      { key: 'COMPANY_NAME', label: 'Company Name', description: 'Your organization name' },
      { key: 'CONTENT', label: 'Content Area', description: 'AI-generated content placeholder' },
    ],
  },
  {
    title: 'Project',
    defaultOpen: true,
    items: [
      { key: 'PROJECT_TITLE', label: 'Project Title', description: 'Project name' },
      { key: 'PROPOSAL_TITLE', label: 'Proposal Title', description: 'Alias for project name' },
      { key: 'PROJECT_POC_NAME', label: 'POC Name', description: 'Primary contact name' },
      { key: 'PROJECT_POC_EMAIL', label: 'POC Email', description: 'Primary contact email' },
      { key: 'PROJECT_POC_PHONE', label: 'POC Phone', description: 'Primary contact phone' },
      { key: 'PROJECT_POC_TITLE', label: 'POC Title', description: 'Primary contact role' },
    ],
  },
  {
    title: 'Opportunity',
    defaultOpen: false,
    items: [
      { key: 'OPPORTUNITY_TITLE', label: 'Opportunity Title', description: 'Official title' },
      { key: 'SOLICITATION_NUMBER', label: 'Solicitation #', description: 'e.g., FA8201-24-R-0001' },
      { key: 'RESPONSE_DEADLINE', label: 'Deadline', description: 'Submission deadline date' },
      { key: 'AGENCY_NAME', label: 'Agency', description: 'Government agency name' },
      { key: 'NAICS_CODE', label: 'NAICS Code', description: 'Classification code' },
      { key: 'SET_ASIDE', label: 'Set-Aside', description: 'Set-aside category' },
      { key: 'ESTIMATED_VALUE', label: 'Est. Value', description: 'Contract estimated value' },
    ],
  },
  {
    title: 'Solicitation Org',
    defaultOpen: false,
    items: [
      { key: 'SOLICITATION_ORG_NAME', label: 'Org Name', description: 'Solicitation org/agency' },
      { key: 'SOLICITATION_ORG_OFFICE', label: 'Office', description: 'Specific office/dept' },
      { key: 'SOLICITATION_ORG_LOCATION', label: 'Location', description: 'Place of performance' },
    ],
  },
  {
    title: 'Contacts',
    defaultOpen: false,
    items: [
      { key: 'CONTRACTING_OFFICER', label: 'CO', description: 'Contracting officer info' },
      { key: 'TECHNICAL_POC', label: 'Tech POC', description: 'Technical POC info' },
    ],
  },
];

const MacroGroupSection = ({
  group,
  onInsert,
  disabled,
}: {
  group: MacroGroup;
  onInsert: (key: string) => void;
  disabled?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(group.defaultOpen ?? false);
  const [justInserted, setJustInserted] = useState<string | null>(null);

  const handleInsert = (key: string) => {
    onInsert(key);
    setJustInserted(key);
    setTimeout(() => setJustInserted(null), 1000);
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-foreground hover:bg-muted/50 transition-colors"
      >
        <span>{group.title}</span>
        {isOpen ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      {isOpen && (
        <div className="border-t border-border">
          {group.items.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => handleInsert(item.key)}
              disabled={disabled}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors',
                'hover:bg-primary/5 disabled:opacity-50 disabled:cursor-not-allowed',
                justInserted === item.key && 'bg-emerald-50 dark:bg-emerald-950/30',
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-foreground truncate">
                    {item.label}
                  </span>
                  {justInserted === item.key && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                      Inserted!
                    </span>
                  )}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">
                  {item.description}
                </div>
              </div>
              <Copy className="h-3 w-3 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const MacroInsertionBar = ({ onInsert, disabled, hideTitle }: MacroInsertionBarProps) => {
  return (
    <div className="space-y-2">
      {!hideTitle && <div className="text-sm font-semibold text-foreground">Insert Variables</div>}
      <div className="space-y-1.5">
        {MACRO_GROUPS.map((group) => (
          <MacroGroupSection
            key={group.title}
            group={group}
            onInsert={onInsert}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
};

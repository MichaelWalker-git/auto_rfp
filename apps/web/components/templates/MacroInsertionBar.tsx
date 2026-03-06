'use client';

import { MacroButton } from './MacroButton';

interface MacroInsertionBarProps {
  onInsert: (key: string) => void;
  disabled?: boolean;
}

const MACRO_GROUPS = [
  {
    label: 'General:',
    macros: [
      {
        key: 'TODAY',
        label: '{{TODAY}}',
        tooltip: "Today's date in YYYY-MM-DD format (e.g., 2024-03-15)",
        special: false,
      },
      {
        key: 'CONTENT',
        label: '{{CONTENT}}',
        tooltip: 'AI will generate content here based on the solicitation requirements and your knowledge base. This is where the main document content goes.',
        special: true,
      },
    ],
  },
  {
    label: 'Company:',
    macros: [
      {
        key: 'COMPANY_NAME',
        label: '{{COMPANY_NAME}}',
        tooltip: 'Your organization name from settings (e.g., "Acme Corporation")',
        special: false,
      },
    ],
  },
  {
    label: 'Project:',
    macros: [
      {
        key: 'PROJECT_TITLE',
        label: '{{PROJECT_TITLE}}',
        tooltip: 'Project name (e.g., "DoD Cloud Migration Project")',
        special: false,
      },
      {
        key: 'PROPOSAL_TITLE',
        label: '{{PROPOSAL_TITLE}}',
        tooltip: 'Same as project title — used as an alias for proposal documents',
        special: false,
      },
      {
        key: 'PROJECT_DESCRIPTION',
        label: '{{PROJECT_DESCRIPTION}}',
        tooltip: 'Project description/overview',
        special: false,
      },
    ],
  },
  {
    label: 'Opportunity:',
    macros: [
      {
        key: 'OPPORTUNITY_TITLE',
        label: '{{OPPORTUNITY_TITLE}}',
        tooltip: 'Official opportunity title (e.g., "Enterprise Cloud Services")',
        special: false,
      },
      {
        key: 'SOLICITATION_NUMBER',
        label: '{{SOLICITATION_NUMBER}}',
        tooltip: 'Official solicitation number (e.g., "FA8201-24-R-0001")',
        special: false,
      },
      {
        key: 'OPPORTUNITY_ID',
        label: '{{OPPORTUNITY_ID}}',
        tooltip: 'Unique opportunity ID (e.g., "140D6424R00004")',
        special: false,
      },
      {
        key: 'RESPONSE_DEADLINE',
        label: '{{RESPONSE_DEADLINE}}',
        tooltip: 'Proposal submission deadline (e.g., "March 30, 2024")',
        special: false,
      },
      {
        key: 'AGENCY_NAME',
        label: '{{AGENCY_NAME}}',
        tooltip: 'Government agency name (e.g., "GSA")',
        special: false,
      },
      {
        key: 'NAICS_CODE',
        label: '{{NAICS_CODE}}',
        tooltip: 'NAICS classification code (e.g., "541512")',
        special: false,
      },
      {
        key: 'SET_ASIDE',
        label: '{{SET_ASIDE}}',
        tooltip: 'Set-aside category (e.g., "Total Small Business Set-Aside")',
        special: false,
      },
    ],
  },
];

export const MacroInsertionBar = ({ onInsert, disabled }: MacroInsertionBarProps) => {
  return (
    <div className="space-y-2 mb-3">
      <div className="text-xs font-medium text-muted-foreground">Insert Variables:</div>
      <div className="space-y-1.5">
        {MACRO_GROUPS.map((group) => (
          <div key={group.label} className="flex items-start gap-2">
            <span className="text-xs text-muted-foreground w-24 pt-0.5 shrink-0">{group.label}</span>
            <div className="flex flex-wrap gap-1.5">
              {group.macros.map((macro) => (
                <MacroButton
                  key={macro.key}
                  macroKey={macro.key}
                  label={macro.label}
                  tooltip={macro.tooltip}
                  onClick={onInsert}
                  disabled={disabled}
                  special={macro.special}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

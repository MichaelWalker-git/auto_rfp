'use client';

import { FileText, ClipboardList, Table2 } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { ProposedEdit } from '@auto-rfp/core';

import { computeWordDiff } from '../lib/wordDiff';

interface ProposalDiffCardProps {
  proposal: ProposedEdit;
  selected: boolean;
  onToggle: (editId: string, checked: boolean) => void;
  disabled?: boolean;
}

const targetLabel = (proposal: ProposedEdit): { icon: React.ReactNode; text: string } => {
  if (proposal.target.kind === 'FORM') {
    return {
      icon: <ClipboardList className="h-3.5 w-3.5" />,
      text: `${proposal.target.formTitle ?? 'Form'} · ${proposal.target.fieldLabel ?? proposal.target.fieldId}`,
    };
  }
  if (proposal.target.kind === 'QUESTIONNAIRE') {
    return {
      icon: <Table2 className="h-3.5 w-3.5" />,
      text: `${proposal.target.documentTitle ?? 'Questionnaire'} · cell ${proposal.target.ref}`,
    };
  }
  const heading = proposal.target.anchor?.kind === 'heading' ? ` · ${proposal.target.anchor.text}` : '';
  return {
    icon: <FileText className="h-3.5 w-3.5" />,
    text: `${proposal.target.documentTitle ?? 'Document'}${heading}`,
  };
};

/**
 * A single before→after proposal with a select checkbox. Reuses the word-diff
 * primitive VersionDiffView uses so the styling matches document version diffs.
 */
export const ProposalDiffCard = ({ proposal, selected, onToggle, disabled }: ProposalDiffCardProps) => {
  const { icon, text } = targetLabel(proposal);
  const parts = computeWordDiff(proposal.before, proposal.after);

  return (
    <Card className={cn('p-3 gap-2', disabled && 'opacity-60')}>
      <div className="flex items-start gap-3">
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onToggle(proposal.editId, checked === true)}
          disabled={disabled}
          aria-label="Select this edit"
          className="mt-1"
        />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary" className="gap-1">
              {icon}
              <span className="truncate max-w-[18rem]">{text}</span>
            </Badge>
          </div>

          {proposal.rationale && (
            <p className="text-xs text-muted-foreground">{proposal.rationale}</p>
          )}

          <div className="rounded-md border bg-muted/30 p-2 text-sm leading-relaxed">
            {parts.map((part, idx) => {
              if (part.type === 'unchanged') return <span key={idx}>{part.value}</span>;
              if (part.type === 'removed') {
                return (
                  <span
                    key={idx}
                    className="bg-red-200 dark:bg-red-900/50 text-red-900 dark:text-red-200 px-0.5 rounded line-through"
                  >
                    {part.value}
                  </span>
                );
              }
              return (
                <span
                  key={idx}
                  className="bg-green-200 dark:bg-green-900/50 text-green-900 dark:text-green-200 px-0.5 rounded"
                >
                  {part.value}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </Card>
  );
};

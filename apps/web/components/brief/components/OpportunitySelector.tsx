'use client';

import React from 'react';
import { Check, ChevronsUpDown, FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { useOpportunitiesList } from '@/lib/hooks/use-opportunities';
import { getSelectedOpportunity, saveSelectedOpportunity } from '@/lib/utils/opportunity-selection';
import type { OpportunityItem } from '@auto-rfp/core';

// Special ID for "Other" option to show legacy questions without opportunityId
export const OTHER_LEGACY_OPPORTUNITY_ID = '__OTHER_LEGACY__';

interface OpportunitySelectorProps {
  projectId: string;
  orgId: string | null;
  selectedOpportunityId: string | null;
  onSelect: (opportunityId: string | null, opportunity: OpportunityItem | null) => void;
  disabled?: boolean;
  /** If true, don't auto-select an opportunity on mount */
  disableAutoSelect?: boolean;
  /** If true, show the "Other / Legacy Questions" option (only for Questions page) */
  showOtherOption?: boolean;
}

export function OpportunitySelector({
  projectId,
  orgId,
  selectedOpportunityId,
  onSelect,
  disabled = false,
  disableAutoSelect = false,
  showOtherOption = false,
}: OpportunitySelectorProps) {
  const [open, setOpen] = React.useState(false);
  const hasAutoSelectedRef = React.useRef(false);
  
  const { items: opportunities, isLoading, error } = useOpportunitiesList({
    orgId,
    projectId,
    limit: 100,
  });

  // Auto-select opportunity when the list loads
  // Priority: 1) sessionStorage saved selection, 2) most recent opportunity
  React.useEffect(() => {
    // Only auto-select if:
    // 1. We haven't already auto-selected
    // 2. No opportunity is currently selected
    // 3. We have opportunities loaded
    // 4. Not currently loading
    // 5. Auto-select is not disabled
    if (
      !hasAutoSelectedRef.current &&
      !selectedOpportunityId &&
      opportunities.length > 0 &&
      !isLoading &&
      !disableAutoSelect
    ) {
      hasAutoSelectedRef.current = true;
      
      // First, check sessionStorage for a previously saved selection
      const savedOppId = getSelectedOpportunity(projectId);
      if (savedOppId) {
        const savedOpp = opportunities.find(
          (opp) => (opp.oppId ?? opp.id) === savedOppId
        );
        if (savedOpp) {
          onSelect(savedOppId, savedOpp);
          return;
        }
      }
      
      // Fallback: Sort by postedDateIso or responseDeadlineIso to get the most recent
      const sortedOpportunities = [...opportunities].sort((a, b) => {
        const dateA = a.postedDateIso || a.responseDeadlineIso || '';
        const dateB = b.postedDateIso || b.responseDeadlineIso || '';
        return dateB.localeCompare(dateA); // Most recent first
      });
      
      const mostRecent = sortedOpportunities[0];
      if (mostRecent) {
        const oppId = mostRecent.oppId ?? mostRecent.id;
        // Save this auto-selection to sessionStorage
        saveSelectedOpportunity(projectId, oppId);
        onSelect(oppId, mostRecent);
      }
    }
  }, [opportunities, selectedOpportunityId, isLoading, onSelect, projectId, disableAutoSelect]);

  // Reset auto-select flag when projectId changes
  React.useEffect(() => {
    hasAutoSelectedRef.current = false;
  }, [projectId]);

  const selectedOpportunity = React.useMemo(() => {
    if (!selectedOpportunityId) return null;
    // Special case for "Other" legacy questions
    if (selectedOpportunityId === OTHER_LEGACY_OPPORTUNITY_ID) return null;
    return opportunities.find(
      (opp) => (opp.oppId ?? opp.id) === selectedOpportunityId
    ) || null;
  }, [selectedOpportunityId, opportunities]);

  const isOtherSelected = selectedOpportunityId === OTHER_LEGACY_OPPORTUNITY_ID;

  const getOpportunityLabel = (opp: OpportunityItem) => {
    const id = opp.oppId ?? opp.id;
    const title = opp.title || 'Untitled';
    const truncatedTitle = title.length > 50 ? title.slice(0, 50) + '...' : title;
    return truncatedTitle;
  };

  const getOpportunityId = (opp: OpportunityItem) => {
    return opp.oppId ?? opp.id;
  };

  if (isLoading) {
    return (
      <Button variant="outline" disabled className="w-full justify-between">
        <span className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading opportunities...
        </span>
      </Button>
    );
  }

  if (error) {
    return (
      <Button variant="outline" disabled className="w-full justify-between text-destructive">
        <span>Failed to load opportunities</span>
      </Button>
    );
  }

  if (opportunities.length === 0) {
    return (
      <Button variant="outline" disabled className="w-full justify-between">
        <span className="flex items-center gap-2 text-muted-foreground">
          <FileText className="h-4 w-4" />
          No opportunities found
        </span>
      </Button>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
          disabled={disabled}
        >
          <span className="flex items-center gap-2 truncate">
            <FileText className="h-4 w-4 flex-shrink-0" />
            {isOtherSelected ? (
              <span className="truncate">Other / Legacy Questions</span>
            ) : selectedOpportunity ? (
              <span className="truncate">{getOpportunityLabel(selectedOpportunity)}</span>
            ) : (
              <span className="text-muted-foreground">Select an opportunity...</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search opportunities..." />
          <CommandList>
            <CommandEmpty>No opportunity found.</CommandEmpty>
            <CommandGroup>
              {opportunities.map((opp) => {
                const oppId = getOpportunityId(opp);
                const isSelected = selectedOpportunityId === oppId;
                return (
                  <CommandItem
                    key={oppId}
                    value={`${opp.title} ${opp.solicitationNumber || ''} ${oppId}`}
                    onSelect={() => {
                      const newOppId = isSelected ? null : oppId;
                      // Save selection to sessionStorage for persistence
                      if (newOppId) {
                        saveSelectedOpportunity(projectId, newOppId);
                      }
                      onSelect(newOppId, isSelected ? null : opp);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        isSelected ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="truncate font-medium">{opp.title || 'Untitled'}</span>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {opp.solicitationNumber && (
                          <span className="truncate">{opp.solicitationNumber}</span>
                        )}
                        {opp.source && (
                          <Badge variant="outline" className="text-xs px-1 py-0">
                            {opp.source === 'SAM_GOV' ? 'SAM.gov' : 'Manual'}
                          </Badge>
                        )}
                        {opp.naicsCode && (
                          <span className="text-xs">NAICS: {opp.naicsCode}</span>
                        )}
                      </div>
                    </div>
                  </CommandItem>
                );
              })}
              {/* Other / Legacy Questions option - only shown on Questions page */}
              {showOtherOption && (
                <CommandItem
                  key={OTHER_LEGACY_OPPORTUNITY_ID}
                  value="Other Legacy Questions unassigned"
                  onSelect={() => {
                    const newOppId = isOtherSelected ? null : OTHER_LEGACY_OPPORTUNITY_ID;
                    if (newOppId) {
                      saveSelectedOpportunity(projectId, newOppId);
                    }
                    onSelect(newOppId, null);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4',
                      isOtherSelected ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="truncate font-medium text-muted-foreground">Other / Legacy Questions</span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>Questions not linked to any opportunity</span>
                    </div>
                  </div>
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
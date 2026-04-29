'use client';

import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export const StaffingPlanInfoPopover = () => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-foreground"
        >
          <Info className="h-3.5 w-3.5" />
          <span className="sr-only">Staffing plan info</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] max-h-[70vh] overflow-y-auto p-0">
        <div className="p-4 border-b">
          <h4 className="font-semibold text-sm">Staffing Plans</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Map labor positions and hours to calculate total labor costs for a proposal
          </p>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <h5 className="text-sm font-medium">Position</h5>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select from the positions defined in your Labor Rates tab. Each position carries
              its fully loaded rate (base + overhead + G&A + profit), so cost calculations are
              automatic.
            </p>
          </div>

          <div>
            <h5 className="text-sm font-medium">Hours</h5>
            <p className="text-xs text-muted-foreground mt-0.5">
              The total estimated hours for each position over the contract period. For
              multi-year contracts, you can create separate plans per period (e.g. Base Period,
              Option Year 1) using the Phase field.
            </p>
          </div>

          <div>
            <h5 className="text-sm font-medium">Phase / Period</h5>
            <p className="text-xs text-muted-foreground mt-0.5">
              Optional label to organize staffing by contract period — Base Period, Option Year
              1, Transition Phase, etc. Helps structure cost volumes for multi-period proposals.
            </p>
          </div>

          <div>
            <h5 className="text-sm font-medium">Total Cost</h5>
            <p className="text-xs text-muted-foreground mt-0.5">
              Calculated automatically as Hours x Fully Loaded Rate for each position. The plan
              total sums all line items to give the total labor cost for the proposal.
            </p>
          </div>

          <div className="border-t pt-3">
            <h5 className="text-sm font-medium">How Staffing Plans Are Used in Proposals</h5>
            <p className="text-xs text-muted-foreground mt-0.5">
              Staffing plans feed into cost estimates and pricing volumes in your RFP responses.
              The AI uses your staffing data to populate labor CLIN pricing, generate staffing
              narrative sections, and assess whether your proposed team meets the
              solicitation&apos;s minimum staffing requirements.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

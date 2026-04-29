'use client';

import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export const LaborRateInfoPopover = () => {
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
          <span className="sr-only">Labor rate info</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] max-h-[70vh] overflow-y-auto p-0">
        <div className="p-4 border-b">
          <h4 className="font-semibold text-sm">Labor Rate Components</h4>
          <p className="text-xs text-muted-foreground mt-1">
            How fully loaded rates are calculated from base rates
          </p>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <h5 className="text-sm font-medium">Overhead (%)</h5>
            <p className="text-xs text-muted-foreground mt-1">
              Indirect costs of running the business that support project work but aren&apos;t
              directly billable — facilities, equipment, IT infrastructure, administrative staff,
              and employee benefits. Applied as a percentage of the base labor rate.
            </p>
          </div>

          <div>
            <h5 className="text-sm font-medium">G&A — General & Administrative (%)</h5>
            <p className="text-xs text-muted-foreground mt-1">
              Company-wide operating expenses not tied to any single contract — executive
              leadership, accounting, legal, HR, insurance, and corporate operations. Applied as a
              percentage on top of the base rate plus overhead.
            </p>
          </div>

          <div>
            <h5 className="text-sm font-medium">Profit (%)</h5>
            <p className="text-xs text-muted-foreground mt-1">
              The fee or margin added after all costs. This is the contractor&apos;s earnings on
              the work. For government contracts, profit rates are typically negotiated and must be
              reasonable. Applied as a percentage on top of all costs.
            </p>
          </div>

          <div className="border-t pt-4">
            <h5 className="text-sm font-medium">Fully Loaded Rate Calculation</h5>
            <p className="text-xs text-muted-foreground mt-1 mb-2">
              Each rate component is applied sequentially to the base rate:
            </p>
            <div className="bg-muted rounded-md p-3 font-mono text-xs space-y-1">
              <p>With Overhead = Base Rate x (1 + Overhead%/100)</p>
              <p>With G&A&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; = With Overhead x (1 + G&A%/100)</p>
              <p>Fully Loaded = With G&A x (1 + Profit%/100)</p>
            </div>
            <div className="mt-3 bg-muted rounded-md p-3 text-xs">
              <p className="font-medium mb-1">Example</p>
              <p className="text-muted-foreground">
                Base Rate $75.00, Overhead 120%, G&A 12%, Profit 10%
              </p>
              <div className="font-mono mt-1 space-y-0.5 text-muted-foreground">
                <p>$75.00 x 1.120 = $84.00 (with overhead)</p>
                <p>$84.00 x 1.12&nbsp; = $94.08 (with G&A)</p>
                <p>$94.08 x 1.10&nbsp; = <span className="text-foreground font-medium">$103.49</span> (fully loaded)</p>
              </div>
            </div>
          </div>

          <div className="border-t pt-4">
            <h5 className="text-sm font-medium">How Rates Are Used in Proposals</h5>
            <p className="text-xs text-muted-foreground mt-1">
              When generating RFP responses, the AI matches solicitation labor categories to your
              rate table using fuzzy matching (e.g. &quot;Sr. Developer&quot; maps to &quot;Senior
              Developer&quot;). Fully loaded rates are used to calculate total labor costs in
              executive briefs, pricing sections, staffing plans, and bid/no-bid analysis. If no
              matching rate is found, the AI flags it so you can add missing positions.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

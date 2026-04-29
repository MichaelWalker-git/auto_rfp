'use client';

import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export const DirectCostInfoPopover = () => {
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
          <span className="sr-only">Direct costs info</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[420px] max-h-[70vh] overflow-y-auto p-0">
        <div className="p-4 border-b">
          <h4 className="font-semibold text-sm">Direct Cost Categories</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Non-labor costs that are directly billable to a contract
          </p>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <h5 className="text-sm font-medium">Software Licenses</h5>
            <p className="text-xs text-muted-foreground mt-0.5">
              Commercial or proprietary software required for contract performance — platform
              subscriptions, per-user SaaS fees, enterprise licenses, and specialized tools.
            </p>
          </div>

          <div>
            <h5 className="text-sm font-medium">Hardware & Equipment</h5>
            <p className="text-xs text-muted-foreground mt-0.5">
              Physical equipment needed for the contract — scanners, servers, barcode systems,
              workstations, secure storage equipment, and specialized devices.
            </p>
          </div>

          <div>
            <h5 className="text-sm font-medium">Subcontractors</h5>
            <p className="text-xs text-muted-foreground mt-0.5">
              Third-party firms performing a portion of the contract work — specialized service
              providers, teaming partners, and consultants billed as a direct cost.
            </p>
          </div>

          <div>
            <h5 className="text-sm font-medium">Travel</h5>
            <p className="text-xs text-muted-foreground mt-0.5">
              Contract-related travel expenses — airfare, lodging, per diem, mileage, and ground
              transportation for on-site work at client facilities.
            </p>
          </div>

          <div>
            <h5 className="text-sm font-medium">Materials & Supplies</h5>
            <p className="text-xs text-muted-foreground mt-0.5">
              Consumable items used during contract performance — storage containers, labeling
              supplies, office materials, and other operational consumables.
            </p>
          </div>

          <div>
            <h5 className="text-sm font-medium">Other Direct Costs (ODC)</h5>
            <p className="text-xs text-muted-foreground mt-0.5">
              Any remaining billable costs that don&apos;t fit the above — training materials,
              shipping, insurance, permits, certifications, and facility costs.
            </p>
          </div>

          <div className="border-t pt-3">
            <h5 className="text-sm font-medium">How Direct Costs Are Used in Proposals</h5>
            <p className="text-xs text-muted-foreground mt-0.5">
              When generating RFP responses, the AI references your direct cost inventory to build
              accurate cost volumes. Items are included in cost estimates, executive brief pricing
              sections, and bid analysis. You can also extract costs from vendor quotes using AI
              to keep your inventory current.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};

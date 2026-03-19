'use client';

import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LaborRateManager } from './LaborRateManager';
import { BOMCalculator } from './BOMCalculator';
import { StaffingPlanBuilder } from './StaffingPlanBuilder';
import { DollarSign, Package, Users, Calculator } from 'lucide-react';

interface PricingContentProps {
  orgId: string;
}

export const PricingContent = ({ orgId }: PricingContentProps) => {
  const [activeTab, setActiveTab] = useState('labor-rates');

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pricing & Cost Estimation</h1>
        <p className="text-muted-foreground mt-1">
          Manage labor rates, bill of materials, staffing plans, and cost estimates.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="labor-rates" className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Labor Rates
          </TabsTrigger>
          <TabsTrigger value="bom" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Bill of Materials
          </TabsTrigger>
          <TabsTrigger value="staffing" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Staffing Plans
          </TabsTrigger>
        </TabsList>

        <TabsContent value="labor-rates" className="mt-6">
          <LaborRateManager orgId={orgId} />
        </TabsContent>

        <TabsContent value="bom" className="mt-6">
          <BOMCalculator orgId={orgId} />
        </TabsContent>

        <TabsContent value="staffing" className="mt-6">
          <StaffingPlanBuilder orgId={orgId} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Globe, Search, Shield } from 'lucide-react';
import SearchOpportunitiesPage from './SearchOpportunitiesPage';
import SamGovOpportunitySearchPage from './samgov-opportunity-search';
import DibbsOpportunitiesPage from '@/components/dibbs/DibbsOpportunitiesPage';

interface Props {
  orgId: string;
}

export default function OpportunitiesPageWithTabs({ orgId }: Props) {
  return (
    <Tabs defaultValue="all" className="w-full">
      <div className="border-b px-12 pt-8">
        <TabsList className="mb-0 h-10">
          <TabsTrigger value="all" className="flex items-center gap-2">
            <Globe className="h-4 w-4" />
            All Sources
          </TabsTrigger>
          <TabsTrigger value="samgov" className="flex items-center gap-2">
            <Search className="h-4 w-4" />
            SAM.gov
          </TabsTrigger>
          <TabsTrigger value="dibbs" className="flex items-center gap-2">
            <Shield className="h-4 w-4" />
            DIBBS
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="all" className="mt-0">
        <SearchOpportunitiesPage orgId={orgId} />
      </TabsContent>

      <TabsContent value="samgov" className="mt-0">
        <SamGovOpportunitySearchPage orgId={orgId} />
      </TabsContent>

      <TabsContent value="dibbs" className="mt-0">
        <DibbsOpportunitiesPage orgId={orgId} />
      </TabsContent>
    </Tabs>
  );
}

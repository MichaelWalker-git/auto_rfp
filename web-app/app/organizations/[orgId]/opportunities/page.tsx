'use client';

import SamGovOpportunitySearchPage from '@/components/opportunities/samgov-opportunity-search';
import { useCurrentOrganization } from '@/context/organization-context';

const OpportunitiesPage = () => {
  const { currentOrganization } = useCurrentOrganization()
  return currentOrganization?.id ? <SamGovOpportunitySearchPage orgId={currentOrganization.id}/> : null;
};

export default OpportunitiesPage;
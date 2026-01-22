'use client';

import SamGovOpportunitySearchPage from '@/components/opportunities/samgov-opportunity-search';
import { useOrganization } from '@/context/organization-context';

const OpportunitiesPage = () => {
  const { currentOrganization } = useOrganization()
  return currentOrganization?.id ? <SamGovOpportunitySearchPage orgId={currentOrganization.id}/> : null;
};

export default OpportunitiesPage;
'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Send } from 'lucide-react';
import { useSubmissionReadiness } from '../hooks/useSubmissionReadiness';
import { useIgnoredChecks } from '../hooks/useIgnoredChecks';
import { useOpportunityContext } from '@/components/opportunities/opportunity-context';
import { useCurrentOrganization } from '@/context/organization-context';

interface SubmitProposalButtonProps {
  orgId: string;
  projectId: string;
  oppId: string;
  onSuccess?: () => void;
}

export const SubmitProposalButton = ({ orgId, projectId, oppId }: SubmitProposalButtonProps) => {
  const { checks, isLoading: isCheckingReadiness } = useSubmissionReadiness(orgId, projectId, oppId);
  const { opportunity, refetch } = useOpportunityContext();
  const { ignoredIds } = useIgnoredChecks({ orgId, projectId, oppId, opportunity, refetch });
  const { currentOrganization } = useCurrentOrganization();
  const navOrgId = currentOrganization?.id ?? orgId;

  const blockingFails = checks.filter((c) => !c.passed && c.blocking && !ignoredIds.has(c.id)).length;

  const href = `/organizations/${navOrgId}/projects/${projectId}/opportunities/${oppId}/submit`;

  return (
    <Button asChild disabled={isCheckingReadiness} size="lg" className="gap-2">
      <Link href={href}>
        <Send className="h-4 w-4" />
        Submit Proposal
        {!isCheckingReadiness && blockingFails > 0 && (
          <Badge variant="secondary" className="ml-1 text-xs">
            {blockingFails} issue{blockingFails !== 1 ? 's' : ''}
          </Badge>
        )}
      </Link>
    </Button>
  );
};

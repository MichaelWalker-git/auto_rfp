'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { PageLoadingSkeleton } from '@/components/layout/page-loading-skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FolderOpen } from 'lucide-react';
import { useProjectContext } from '@/context/project-context';

interface Props {
  orgId: string;
  /** Sub-path to preserve under the project route, e.g. `saved-searches`. */
  subPath?: string;
}

/**
 * Redirects the retired org-level search route into the canonical project-level one.
 *
 * There used to be two Search Opportunities pages with different feature sets, and
 * the sidebar only ever linked the project-level one. Searching is now project-scoped
 * throughout — an import always lands in a specific project — so the org route just
 * forwards, preserving any query string so old bookmarked searches still run.
 */
export const SearchOpportunitiesRedirect = ({ orgId, subPath }: Props) => {
  const router = useRouter();
  const { currentProject, projects, loading } = useProjectContext();

  // Fall back to the first project when nothing is selected yet — a direct visit to
  // this URL in a fresh session has no remembered project.
  const targetProjectId = currentProject?.id ?? projects?.[0]?.id;

  useEffect(() => {
    if (loading || !targetProjectId) return;
    const search = typeof window === 'undefined' ? '' : window.location.search;
    const suffix = subPath ? `/${subPath}` : '';
    router.replace(
      `/organizations/${orgId}/projects/${targetProjectId}/search-opportunities${suffix}${search}`,
    );
  }, [loading, targetProjectId, orgId, subPath, router]);

  if (!loading && !targetProjectId) {
    return (
      <div className="container mx-auto p-8 max-w-3xl">
        <Alert>
          <FolderOpen className="h-4 w-4" />
          <AlertTitle>Create a project first</AlertTitle>
          <AlertDescription className="space-y-2">
            <p className="text-sm">
              Opportunity search is scoped to a project, because importing a solicitation
              pulls its documents into one. Create a project to start searching.
            </p>
            <Button asChild size="sm" variant="outline">
              <Link href={`/organizations/${orgId}/projects`}>Go to projects</Link>
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return <PageLoadingSkeleton hasDescription variant="list" rowCount={5} />;
};

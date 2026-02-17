import { redirect } from 'next/navigation';

/**
 * FOIA Requests are now managed within the Opportunity context.
 * This page redirects to the Opportunities page.
 */
interface FOIAPageProps {
  params: Promise<{ orgId: string; projectId: string }>;
}

export default async function FOIAPage({ params }: FOIAPageProps) {
  const { orgId, projectId } = await params;
  redirect(`/organizations/${orgId}/projects/${projectId}/opportunities`);
}

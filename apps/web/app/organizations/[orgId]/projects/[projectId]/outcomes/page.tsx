import { redirect } from 'next/navigation';

/**
 * Project Outcomes are now managed within the Opportunity context.
 * This page redirects to the Opportunities page.
 */
interface OutcomesPageProps {
  params: Promise<{ orgId: string; projectId: string }>;
}

export default async function OutcomesPage({ params }: OutcomesPageProps) {
  const { orgId, projectId } = await params;
  redirect(`/organizations/${orgId}/projects/${projectId}/opportunities`);
}

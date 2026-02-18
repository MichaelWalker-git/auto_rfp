import { redirect } from 'next/navigation';

/**
 * RFP Documents are now managed within the Opportunity context.
 * This page redirects to the Opportunities page.
 */
interface RFPDocumentsPageProps {
  params: Promise<{ orgId: string; projectId: string }>;
}

export default async function RFPDocumentsPage({ params }: RFPDocumentsPageProps) {
  const { orgId, projectId } = await params;
  redirect(`/organizations/${orgId}/projects/${projectId}/opportunities`);
}

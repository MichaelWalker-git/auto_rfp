import { redirect } from 'next/navigation';

interface PageProps {
  params: Promise<{ orgId: string; kbId: string }>;
}

// Redirect old KB-level semantic search to the new settings page
export default async function SemanticSearchTestPage({ params }: PageProps) {
  const { orgId } = await params;
  redirect(`/organizations/${orgId}/settings/semantic-search`);
}

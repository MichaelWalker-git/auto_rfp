import { redirect } from 'next/navigation';

interface ProjectPageProps {
  params: Promise<{ orgId: string; projectId: string }>;
}

export default async function ProjectPage({ params }: ProjectPageProps) {
  const { orgId, projectId } = await params;
  redirect(`/organizations/${orgId}/projects/${projectId}/dashboard`);
}

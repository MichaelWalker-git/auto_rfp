import { redirect } from 'next/navigation';

interface StaleReportRedirectProps {
  params: Promise<{ orgId: string }>;
}

// Redirect old content-library/stale-report to the new org-level stale report
export default async function StaleReportRedirect({ params }: StaleReportRedirectProps) {
  const { orgId } = await params;
  redirect(`/organizations/${orgId}/stale-report`);
}

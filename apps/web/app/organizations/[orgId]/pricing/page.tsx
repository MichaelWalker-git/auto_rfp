import { PricingContent } from '@/components/pricing/PricingContent';

interface PageProps {
  params: Promise<{ orgId: string }>;
}

export default async function PricingPage({ params }: PageProps) {
  const { orgId } = await params;

  return <PricingContent orgId={orgId} />;
}

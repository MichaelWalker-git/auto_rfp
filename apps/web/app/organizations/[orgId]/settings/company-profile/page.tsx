import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CompanyProfileForm } from '@/features/company-profile';

interface CompanyProfilePageProps {
  params: Promise<{ orgId: string }>;
}

export default async function CompanyProfilePage({ params }: CompanyProfilePageProps) {
  const { orgId } = await params;

  return (
    <div className="container mx-auto p-12">
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={`/organizations/${orgId}/settings`} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            Back to Settings
          </Link>
        </Button>
      </div>
      <CompanyProfileForm orgId={orgId} />
    </div>
  );
}

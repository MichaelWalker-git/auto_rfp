'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { ContentLibrary } from '@/components/content-library';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Library } from 'lucide-react';
import Link from 'next/link';
import { useToast } from '@/components/ui/use-toast';

interface ContentLibraryPageProps {
  params: Promise<{ orgId: string }>;
}

export default function ContentLibraryPage({ params }: ContentLibraryPageProps) {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  // Handle async params
  useEffect(() => {
    const handleParams = async () => {
      const { orgId } = await params;
      setOrganizationId(orgId);
    };

    handleParams();
  }, [params]);

  // Fetch organization name for breadcrumb
  useEffect(() => {
    const fetchOrganization = async () => {
      if (!organizationId) return;

      try {
        setIsLoading(true);
        const response = await fetch(`/api/organizations/${organizationId}`);

        if (!response.ok) {
          throw new Error('Failed to fetch organization');
        }

        const data = await response.json();
        setOrganizationName(data.name);
        setError(null);
      } catch (err) {
        console.error('Error fetching organization:', err);
        setError('Failed to load organization');
        toast({
          title: 'Error',
          description: 'Failed to load organization data',
          variant: 'destructive',
        });
      } finally {
        setIsLoading(false);
      }
    };

    if (organizationId) {
      fetchOrganization();
    }
  }, [organizationId, toast]);

  if (isLoading) {
    return (
      <div className="container mx-auto p-6">
        <div className="animate-pulse flex flex-col gap-4 w-full max-w-4xl">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-2"></div>
          <div className="h-12 bg-gray-200 rounded w-1/3"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2"></div>
          <div className="h-64 bg-gray-200 rounded w-full mt-4"></div>
        </div>
      </div>
    );
  }

  if (error || !organizationId) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex flex-col items-center justify-center h-64">
          <Library className="h-12 w-12 text-muted-foreground mb-4" />
          <h1 className="text-2xl font-bold mb-2">Unable to Load Content Library</h1>
          <p className="text-muted-foreground mb-4">
            {error || 'Organization not found'}
          </p>
          <Link href="/organizations">
            <Button>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Organizations
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
        <Link
          href={`/organizations/${organizationId}`}
          className="hover:text-foreground transition-colors"
        >
          {organizationName || 'Organization'}
        </Link>
        <span>/</span>
        <span className="text-foreground font-medium">Content Library</span>
      </nav>

      {/* Content Library Component */}
      <ContentLibrary orgId={organizationId} />
    </div>
  );
}

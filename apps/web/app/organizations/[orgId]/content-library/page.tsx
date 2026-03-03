import { ContentLibraryContainer } from '@/components/content-library';

interface ContentLibraryPageProps {
  params: Promise<{ orgId: string }>;
}

export default async function ContentLibraryPage({ params }: ContentLibraryPageProps) {
  const { orgId } = await params;

  return (
    <div className="container mx-auto p-12">
      <ContentLibraryContainer orgId={orgId} />
    </div>
  );
}

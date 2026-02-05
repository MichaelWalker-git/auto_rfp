import { ContentLibraryContainer } from '@/components/content-library';

interface ContentLibraryPageProps {
  params: Promise<{ orgId: string, kbId: string }>;
}

export default async function ContentLibraryPage({ params }: ContentLibraryPageProps) {
  const { orgId, kbId } = await params;

  return (
    <div className="container mx-auto p-6">
      <ContentLibraryContainer orgId={orgId} kbId={kbId}/>
    </div>
  );
}

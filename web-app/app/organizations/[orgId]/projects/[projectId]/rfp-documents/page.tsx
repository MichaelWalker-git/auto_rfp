import React from 'react';
import { RFPDocumentsContent } from '@/components/rfp-documents/rfp-documents-content';

interface RFPDocumentsPageProps {
  params: Promise<{ projectId: string; orgId: string }>;
}

export default async function RFPDocumentsPage({ params }: RFPDocumentsPageProps) {
  const { projectId, orgId } = await params;

  return (
    <RFPDocumentsContent projectId={projectId} orgId={orgId} />
  );
}
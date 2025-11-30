import React from "react";
import { DocumentsSection } from "../../components/documents-section";

interface DocumentsPageProps {
  params: Promise<{ projectId: string }>;
}

export default async function DocumentsPage({ params }: DocumentsPageProps) {
  const { projectId } = await params;
  
  return <DocumentsSection projectId={projectId} />;
} 
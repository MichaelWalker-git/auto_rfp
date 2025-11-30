'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Toaster } from '@/components/ui/toaster';
import { toast } from '@/components/ui/use-toast';
import { DocumentViewer } from '@/components/upload/DocumentViewer';
import { FileList } from '@/components/upload/FileList';
import { UploadSection } from '@/components/upload/UploadSection';
import { ProcessingStatus } from '@/components/ProcessingModal';
import { DocumentParseResult } from '@/lib/validators/document-parse';

interface UploadComponentProps {
  projectId: string | null;
}

export function UploadComponent({ projectId }: UploadComponentProps) {
  const router = useRouter();
  const [uploadedFiles, setUploadedFiles] = useState<DocumentParseResult[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<DocumentParseResult | null>(null);
  const [viewingDocument, setViewingDocument] = useState<boolean>(false);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>('uploading');

  // Handle file upload completion
  const handleFileProcessed = async (result: DocumentParseResult) => {

    // Add project ID to the result object for reference
    const resultWithProject: DocumentParseResult = {
      ...result,
      // projectId: projectId || undefined
    };

    try {

      // Update status to extracting when OpenAI is processing
      setProcessingStatus('extracting');




      // Mark as complete
      setProcessingStatus('complete');

      // Add to uploaded files
      setUploadedFiles(prev => [...prev, resultWithProject]);

      // Wait a moment to show completion state before redirecting
      setTimeout(() => {
        // Redirect to questions page
        router.push(`/projects/${projectId}/questions`);
      }, 1000);
    } catch (error) {
      console.error('Error processing document:', error);
      toast({
        title: 'Error',
        description: 'Failed to process document',
        variant: 'destructive',
      });
    }
  };

  // Update processing status from child components
  const updateProcessingStatus = (status: ProcessingStatus) => {
    setProcessingStatus(status);
  };

  // Handle document selection for viewing
  const handleViewDocument = (doc: DocumentParseResult) => {
    setSelectedDocument(doc);
    setViewingDocument(true);
  };

  // Handle back button click to return to file list
  const handleBackToList = () => {
    setViewingDocument(false);
  };

  return (
    <>
      {viewingDocument && selectedDocument ? (
        <DocumentViewer
          document={selectedDocument}
          onBack={handleBackToList}
          updateProcessingStatus={updateProcessingStatus}
        />
      ) : (
        <>
          <UploadSection
            onFileProcessed={handleFileProcessed}
            processingStatus={processingStatus}
            updateProcessingStatus={updateProcessingStatus}
          />
          <FileList files={uploadedFiles} onViewDocument={handleViewDocument}/>
        </>
      )}

      <Toaster/>
    </>
  );
} 
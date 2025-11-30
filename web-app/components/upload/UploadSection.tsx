import React from 'react';
import { FileUploader } from '@/components/FileUploader';
import { ProcessingStatus } from '@/components/ProcessingModal';
import { DocumentParseResult } from '@/lib/validators/document-parse';

interface UploadSectionProps {
  onFileProcessed: (result: DocumentParseResult) => void;
  processingStatus?: ProcessingStatus;
  updateProcessingStatus?: (status: ProcessingStatus) => void;
}

export function UploadSection({ 
  onFileProcessed, 
  processingStatus, 
  updateProcessingStatus 
}: UploadSectionProps) {
  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="flex flex-col items-center space-y-8">
        {/* Welcome Section */}
        <div className="text-center space-y-2">
          <p className="text-muted-foreground">Welcome to AutoRFP</p>
          <h2 className="text-2xl font-semibold">Get started by adding sections to the project.</h2>
        </div>
        
        {/* Upload Section */}
        <div className="w-full max-w-2xl">
              <FileUploader 
                onFileProcessed={onFileProcessed}
                processingStatus={processingStatus}
                updateProcessingStatus={updateProcessingStatus}
              />
        </div>
      </div>
    </div>
  );
} 
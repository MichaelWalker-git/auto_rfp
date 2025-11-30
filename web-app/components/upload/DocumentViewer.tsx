import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LlamaParseResult } from "@/types/api";
import { Spinner } from "@/components/ui/spinner";
import { useRouter } from "next/navigation";
import { ProcessingStatus } from "@/components/ProcessingModal";
import { DocumentParseResult } from '@/lib/validators/document-parse';
import { useExtractQuestions } from '@/lib/hooks/use-extract-questions';

interface DocumentViewerProps {
  document: DocumentParseResult;
  onBack: () => void;
  updateProcessingStatus?: (status: ProcessingStatus) => void;
}

export function DocumentViewer({ document, onBack, updateProcessingStatus }: DocumentViewerProps) {
  const router = useRouter();
  const {
    extractQuestions,
    data: extractedQuestions,
    isLoading: isExtracting,
    error: extractError,
  } = useExtractQuestions();

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <Button 
            variant="outline" 
            onClick={onBack}
            className="mb-2"
          >
            ← Back to Files
          </Button>
          <h1 className="text-3xl font-bold">{document.s3Key}</h1>
          <p className="text-muted-foreground">
            Processed with {document.s3Key} mode • {document.s3Key} words
          </p>
        </div>
        <Button 
          onClick={() => extractQuestions({
            s3Key: document.s3Key,
            projectId: document.projectId || ''
          })}
          disabled={isExtracting}
          className="bg-blue-600 hover:bg-blue-700"
        >
          {isExtracting ? (
            <>
              <Spinner className="mr-2" size="sm" />
              Extracting Questions...
            </>
          ) : (
            'Get Questions'
          )}
        </Button>
      </div>
      
      <Card>
        <CardContent className="p-6">
          <div className="whitespace-pre-wrap font-mono text-sm bg-muted p-4 rounded-md max-h-[70vh] overflow-auto">
            {document.s3Key || "No content available for this document."}
          </div>
        </CardContent>
      </Card>
    </div>
  );
} 
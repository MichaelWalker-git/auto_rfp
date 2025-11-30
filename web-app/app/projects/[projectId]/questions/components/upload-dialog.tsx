"use client"

import React, { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FileUploader } from "@/components/FileUploader"
import { ProcessingStatus } from "@/components/ProcessingModal"
import { toast } from "@/components/ui/use-toast"
import { DocumentParseResult } from '@/lib/validators/document-parse';
import { useExtractQuestions } from '@/lib/hooks/use-extract-questions';

interface UploadDialogProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  onUploadComplete: () => void
}

export function UploadDialog({ isOpen, onClose, projectId, onUploadComplete }: UploadDialogProps) {
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>("uploading")
  const {
    extractQuestions,
    data: extractedQuestions,
    isLoading: isExtracting,
    error: extractError,
  } = useExtractQuestions();

  const handleFileProcessed = async (result: DocumentParseResult) => {

    try {
      // Update status to parsing when starting OpenAI processing
      setProcessingStatus("parsing")

      // Update status to extracting when OpenAI is processing
      setProcessingStatus("extracting")

      extractQuestions({
        s3Key: result.s3Key,
        projectId: projectId,
      })

      // Get the response data
      // Mark as complete
      setProcessingStatus("complete")

      // Show success toast
      toast({
        title: "Success",
        description: "Document uploaded and questions extracted successfully!",
      })

      // Wait a moment to show completion state before closing
      setTimeout(() => {
        onClose()
        onUploadComplete() // Refresh the questions data
        setProcessingStatus("uploading") // Reset for next upload
      }, 1500)
    } catch (error) {
      console.error('Error processing document:', error)
      toast({
        title: 'Error',
        description: 'Failed to process document',
        variant: 'destructive',
      })
      setProcessingStatus("uploading") // Reset status on error
      onClose()
    }
  }

  const handleClose = () => {
    // Only allow closing if not currently processing
    if (processingStatus === "uploading" || processingStatus === "complete") {
      onClose()
      setProcessingStatus("uploading") // Reset status when closing
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Documents</DialogTitle>
          <DialogDescription>
            Upload documents to automatically extract questions using AI, or add questions manually after upload.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <FileUploader
            onFileProcessed={handleFileProcessed}
            processingStatus={processingStatus}
            updateProcessingStatus={setProcessingStatus}
            filePrefix={projectId}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
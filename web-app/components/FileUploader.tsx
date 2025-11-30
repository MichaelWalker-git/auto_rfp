'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { Spinner } from '@/components/ui/spinner';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ProcessingModal, ProcessingStatus } from './ProcessingModal';
import { DocumentParseResult } from '@/lib/validators/document-parse';
import { uploadFileToS3, usePresignUpload } from '@/lib/hooks/usePresign';
import { useStartTextractExtraction, useTextractResult } from '@/lib/hooks/use-textract';

interface FileUploaderProps {
  onFileProcessed?: (result: DocumentParseResult) => void;
  processingStatus?: ProcessingStatus;
  updateProcessingStatus?: (status: ProcessingStatus) => void;
  filePrefix: string; // we are going to use projectId as a prefix
}

export function FileUploader({
                               onFileProcessed,
                               processingStatus: externalProcessingStatus,
                               updateProcessingStatus: externalUpdateProcessingStatus,
                               filePrefix = ''
                             }: FileUploaderProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [parsingMode, setParsingMode] = useState<string>('balanced');
  const [documentName, setDocumentName] = useState<string>('');
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [dragActive, setDragActive] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Processing modal state - use external state if provided
  const [showProcessingModal, setShowProcessingModal] = useState(false);
  const [internalProcessingStatus, setInternalProcessingStatus] = useState<ProcessingStatus>('uploading');
  const [processingProgress, setProcessingProgress] = useState(0);
  const [processedResult, setProcessedResult] = useState<DocumentParseResult | null>(null);

  const { trigger: presignUpload, isMutating: isPresigning } = usePresignUpload();

  const { startExtraction } = useStartTextractExtraction();
  const { checkTextract } = useTextractResult();

  const processingStatus = externalProcessingStatus || internalProcessingStatus;

  // Function to update processing status - calls external handler if provided
  const updateProcessingStatus = (status: ProcessingStatus) => {
    if (externalUpdateProcessingStatus) {
      externalUpdateProcessingStatus(status);
    } else {
      setInternalProcessingStatus(status);
    }

    // If status is "complete", hide the modal after a brief delay
    if (status === 'complete') {
      setTimeout(() => {
        setShowProcessingModal(false);
      }, 2000);
    }
  };

  // Debug effect to monitor modal state
  useEffect(() => {
    console.log('Processing modal state changed:', showProcessingModal);
    if (showProcessingModal) {
      console.log('Modal shown with status:', processingStatus);
    }
  }, [showProcessingModal, processingStatus]);

  // Handle drag events
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  // Handle drop event
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  // Handle file validation and state update
  const handleFile = (file: File) => {
    const fileExtension = file.name.split('.').pop()?.toLowerCase();

    if (
      fileExtension === 'csv' ||
      fileExtension === 'xlsx' ||
      fileExtension === 'xls' ||
      fileExtension === 'pdf'
    ) {
      setFile(file);
      if (!documentName) {
        setDocumentName(file.name.split('.')[0]);
      }
    } else {
      toast({
        title: 'Unsupported file format',
        description:
          'Please upload an Excel (.xlsx, .xls), CSV (.csv), or PDF file.',
        variant: 'destructive',
      });
    }
  };

  async function pollUntilReady(jobId: string, s3Key: string, bucket?: string) {
    const maxAttempts = 15;
    const delayMs = 6000;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      console.log(`Polling Textract... attempt ${attempt}`);

      const result = await checkTextract({ jobId, s3Key, s3Bucket: bucket });

      if (result.status === 'SUCCEEDED' && result.txtKey) {
        return result.txtKey;
      }

      if (result.status === 'FAILED') {
        throw new Error(result.message || 'Textract failed');
      }

      // still running → wait & retry
      await new Promise((res) => setTimeout(res, delayMs));
    }

    throw new Error('Textract timeout – no result after multiple attempts');
  }


  // Handle file upload via presigned URL + LlamaParse
  const handleUpload = async () => {
    if (!file) {
      toast({ title: 'No file selected', description: 'Please select a file.', variant: 'destructive' });
      return;
    }

    if (!documentName.trim()) {
      toast({ title: 'Document name required', description: 'Please provide a name.', variant: 'destructive' });
      return;
    }

    updateProcessingStatus('uploading');
    setProcessingProgress(0);
    setShowProcessingModal(true);
    setIsUploading(true);

    const progressTimer = setTimeout(() => {
      if (processingStatus === 'uploading') {
        updateProcessingStatus('analyzing');
      }
    }, 3000);

    try {
      // 1. PRESIGN
      const presign = await presignUpload({
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        prefix: filePrefix,
      });

      // 2. UPLOAD
      await uploadFileToS3(presign.url, presign.method, file);

      clearTimeout(progressTimer);
      setIsUploading(false);

      // 3. TEXTRACT START
      updateProcessingStatus('analyzing');
      const textractStart = await startExtraction({
        s3Key: presign.key,
        s3Bucket: presign.bucket,
      });

      // 4. TEXTRACT POLLING
      updateProcessingStatus('mapping');
      const txtKey = await pollUntilReady(textractStart.jobId, presign.key, presign.bucket);

      updateProcessingStatus('parsing');

      console.log('TXT result:', txtKey);

      // 5. Continue to your question parsing
      if (onFileProcessed) {
        onFileProcessed({ s3Key: txtKey });

        setTimeout(() => {
          updateProcessingStatus('extracting');
        }, 1500);
      } else {
        setShowProcessingModal(false);
      }
    } catch (error) {
      clearTimeout(progressTimer);

      toast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });

      setIsUploading(false);
      setShowProcessingModal(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Upload Document</CardTitle>
          <CardDescription>
            Upload an Excel, CSV, or PDF file to be processed by LlamaParse
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* File Upload Area with Drag & Drop */}
            <div
              className={`border-2 border-dashed rounded-lg p-10 text-center transition-colors cursor-pointer ${
                dragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:bg-muted/50'
              }`}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center justify-center gap-4">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="40"
                  height="40"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={dragActive ? 'text-primary' : 'text-muted-foreground'}
                >
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <div>
                  <p className="font-medium">
                    Drag and drop your file here or click to browse
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Supports Excel (.xlsx, .xls), CSV (.csv), and PDF files
                  </p>
                </div>

                {/* Hidden input – still in the DOM, just visually hidden */}
                <Input
                  type="file"
                  accept=".xlsx,.xls,.csv,.pdf"
                  ref={inputRef}
                  onChange={handleChange}
                  className="sr-only" // instead of "hidden"
                />

                <Button
                  size="sm"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    inputRef.current?.click();
                  }}
                >
                  Select File
                </Button>
              </div>
            </div>

            {/* Advanced Settings Accordion */}
            <Accordion type="single" collapsible className="w-full">
              <AccordionItem value="advanced-settings">
                <AccordionTrigger className="text-sm font-medium">
                  Advanced Settings
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-4 pt-2">
                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Parsing Mode
                      </label>
                      <Select
                        defaultValue="balanced"
                        value={parsingMode}
                        onValueChange={setParsingMode}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select parsing mode"/>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fast">
                            Fast (Simple, text-only documents)
                          </SelectItem>
                          <SelectItem value="balanced">
                            Balanced (Default for mixed content)
                          </SelectItem>
                          <SelectItem value="premium">
                            Premium (Complex documents with tables/images)
                          </SelectItem>
                          <SelectItem value="complexTables">
                            Complex Tables (Specialized for tables)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground mt-1">
                        Choose the appropriate mode based on your document's
                        complexity
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-2">
                        Document Name
                      </label>
                      <Input
                        placeholder="Enter a name for this document"
                        className="w-full"
                        value={documentName}
                        onChange={(e) => setDocumentName(e.target.value)}
                      />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between border-t pt-6">
          <div className="space-y-1">
            <p className="text-sm">
              Selected File:{' '}
              {file ? (
                <span className="font-medium">{file.name}</span>
              ) : (
                <span className="italic text-muted-foreground">
                  No file selected
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">Powered by LlamaParse</p>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleUpload}
              disabled={!file || isUploading || isPresigning}
            >
              {isUploading || isPresigning ? (
                <>
                  <Spinner className="mr-2" size="sm"/>
                  Processing...
                </>
              ) : (
                'Upload & Process'
              )}
            </Button>
          </div>
        </CardFooter>
      </Card>

      {/* Processing Modal - simpler implementation without using Dialog */}
      <ProcessingModal
        isOpen={showProcessingModal}
        fileName={file?.name || 'Unknown file'}
        status={processingStatus}
        progress={processingProgress}
      />
    </>
  );
}

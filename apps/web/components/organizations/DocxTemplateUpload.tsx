'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/components/ui/use-toast';
import { Spinner } from '@/components/ui/spinner';
import { uploadFileToS3, usePresignUpload, usePresignDownload } from '@/lib/hooks/use-presign';
import { FileUp, File, Download, Trash2, CheckCircle } from 'lucide-react';
import PermissionWrapper from '@/components/permission-wrapper';

interface DocxTemplateUploadProps {
  orgId: string;
  onSuccess?: () => void;
}

export function DocxTemplateUpload({ orgId, onSuccess }: DocxTemplateUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [templateExists, setTemplateExists] = useState(false);
  const [isCheckingTemplate, setIsCheckingTemplate] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { trigger: presignUpload, isMutating: isPresigning } = usePresignUpload();
  const { trigger: presignDownload } = usePresignDownload();

  // Check if template exists on mount
  useEffect(() => {
    const checkTemplate = async () => {
      try {
        setIsCheckingTemplate(true);
        await presignDownload({ key: `${orgId}/template.docx` });
        setTemplateExists(true);
      } catch (error) {
        // Template doesn't exist
        setTemplateExists(false);
      } finally {
        setIsCheckingTemplate(false);
      }
    };

    checkTemplate();
  }, [orgId, presignDownload]);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

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

  const handleFile = (selectedFile: File) => {
    const fileExtension = selectedFile.name.split('.').pop()?.toLowerCase();

    if (fileExtension !== 'docx') {
      toast({
        title: 'Invalid file format',
        description: 'Please upload a Word document (.docx) file.',
        variant: 'destructive',
      });
      return;
    }

    if (selectedFile.size > 50 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Please upload a file smaller than 50MB.',
        variant: 'destructive',
      });
      return;
    }

    setFile(selectedFile);
  };

  const handleDownloadTemplate = async () => {
    try {
      const presign = await presignDownload({ key: `${orgId}/template.docx` });
      window.open(presign.url, '_blank');
    } catch (error) {
      toast({
        title: 'Download failed',
        description: 'Failed to download template',
        variant: 'destructive',
      });
    }
  };

  const handleUpload = async () => {
    if (!file) {
      toast({
        title: 'No file selected',
        description: 'Please select a DOCX file to upload.',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);

    try {
      // Get presigned URL with the key format: orgId/template.docx
      const presign = await presignUpload({
        fileName: 'template.docx',
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        key: `${orgId}/template.docx`,
      });

      // Upload file to S3
      await uploadFileToS3(presign.url, presign.method, file);

      toast({
        title: 'Success',
        description: 'DOCX template uploaded successfully. This will be used for generating Word documents with your branding.',
      });

      setFile(null);
      if (inputRef.current) {
        inputRef.current.value = '';
      }

      setTemplateExists(true);

      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      console.error('Error uploading template:', error);
      toast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Failed to upload template',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  if (isCheckingTemplate) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Word Document Template</CardTitle>
          <CardDescription>
            Upload a DOCX template that will be used as the base for generating Word documents with your organization's branding
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Spinner className="mr-2" size="sm" />
            <span className="text-sm text-muted-foreground">Checking for existing template...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Word Document Template</CardTitle>
        <CardDescription>
          Upload a DOCX template that will be used as the base for generating Word documents with your organization's branding
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Existing Template Display */}
          {templateExists && !file && (
            <div className="flex items-center gap-3 p-4 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
              <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-sm text-green-900 dark:text-green-100">
                  Template uploaded
                </p>
                <p className="text-xs text-green-700 dark:text-green-300">
                  Your organization has an active Word template
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDownloadTemplate}
                >
                  <Download className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {/* File Upload Area with Drag & Drop */}
          {!file && (
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                dragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:bg-muted/50'
              }`}
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
            >
              <div className="flex flex-col items-center justify-center gap-3">
                <FileUp
                  className={`w-10 h-10 ${dragActive ? 'text-primary' : 'text-muted-foreground'}`}
                />
                <div>
                  <p className="font-medium">
                    {templateExists ? 'Replace your template' : 'Drag and drop your DOCX file here or click to browse'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Supports Word documents (.docx) up to 50MB
                  </p>
                </div>

                <input
                  type="file"
                  accept=".docx"
                  ref={inputRef}
                  onChange={handleChange}
                  className="sr-only"
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
          )}

          {/* Selected File Display */}
          {file && (
            <div className="flex items-center gap-3 p-4 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
              <File className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate text-blue-900 dark:text-blue-100">{file.name}</p>
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFile(null);
                  if (inputRef.current) {
                    inputRef.current.value = '';
                  }
                }}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter>
        {file && (
          <PermissionWrapper requiredPermission={'org:edit'}>
            <Button
              onClick={handleUpload}
              disabled={isUploading || isPresigning}
              className="w-full"
            >
              {isUploading || isPresigning ? (
                <>
                  <Spinner className="mr-2" size="sm" />
                  Uploading...
                </>
              ) : (
                templateExists ? 'Replace Template' : 'Upload Template'
              )}
            </Button>
          </PermissionWrapper>
        )}
      </CardFooter>
    </Card>
  );
}
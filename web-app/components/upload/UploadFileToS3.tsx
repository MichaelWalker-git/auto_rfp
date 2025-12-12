"use client";

import React, { useState } from 'react';
import { usePresignUpload } from '@/lib/hooks/use-presign';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/components/ui/use-toast';
import { FileIcon, Upload } from 'lucide-react';

interface UploadFileToS3Props {
  prefix?: string;
  onUploaded?: (result: {
    fileKey: string;
    fileId: string;
    sortKey: string;
    fileName: string;
  }) => void;
  buttonLabel?: string;
}

export function UploadFileToS3({
                                 prefix,
                                 onUploaded,
                                 buttonLabel = "Upload File",
                               }: UploadFileToS3Props) {
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const {
    trigger: getPresignedUrl,
    isMutating: isSigning,
  } = usePresignUpload();

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);

    try {
      // 1. Request presigned URL
      const presign = await getPresignedUrl({
        fileName: file.name,
        contentType: file.type,
        prefix, // optional
      });

      // 2. Upload to S3
      await uploadFileWithProgress(presign.url, presign.method, file);

      // 3. Emit callback
      onUploaded?.({
        fileKey: presign.key,
        fileId: presign.file.fileId,
        sortKey: presign.file.sortKey,
        fileName: file.name,
      });

      toast({
        title: "Upload complete!",
        description: `${file.name} uploaded successfully.`,
      });

      // Reset
      setUploadProgress(0);
      setSelectedFile(null);
    } catch (error: any) {
      console.error("Upload error:", error);
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error.message,
      });
    }
  }

  // Upload w/ progress tracking
  async function uploadFileWithProgress(url: string, method: string, file: File) {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error(`Upload error: ${xhr.statusText}`));
      };

      xhr.onerror = () => reject(new Error("Network upload failed"));

      xhr.open(method || "PUT", url);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.send(file);
    });
  }

  return (
    <div className="space-y-4">
      <label className="block">
        <Button type="button" asChild variant="default">
          <label className="cursor-pointer flex items-center gap-2">
            <Upload className="h-4 w-4" />
            {buttonLabel}
            <input
              type="file"
              onChange={handleFileSelect}
              className="hidden"
              disabled={isSigning}
            />
          </label>
        </Button>
      </label>

      {/* Show selected file */}
      {selectedFile && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <FileIcon className="h-4 w-4" />
          <span>{selectedFile.name}</span>
        </div>
      )}

      {/* Progress bar */}
      {uploadProgress > 0 && (
        <Progress value={uploadProgress} className="h-2" />
      )}
    </div>
  );
}

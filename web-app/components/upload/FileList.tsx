import React from "react";
import { Button } from "@/components/ui/button";
import { DocumentParseResult } from '@/lib/validators/document-parse';

interface FileListProps {
  files: DocumentParseResult[];
  onViewDocument: (document: DocumentParseResult) => void;
}

export function FileList({ files, onViewDocument }: FileListProps) {
  if (files.length === 0) {
    return null;
  }
  
  return (
    <div className="mb-8">
      <h2 className="text-xl font-semibold mb-4">Uploaded Files</h2>
      <ul className="space-y-2">
        {files.map((file, index) => (
          <li 
            key={index} 
            className="p-4 border rounded-md bg-white flex justify-between items-center hover:bg-slate-50 cursor-pointer transition-colors"
            onClick={() => onViewDocument(file)}
          >
            <div>
              <p className="font-medium">{file.s3Key}</p>
              <p className="text-sm text-muted-foreground">
                Processed with {file.s3Key} mode • {file.s3Key} words
              </p>
            </div>
            <Button variant="secondary" size="sm">View Content</Button>
          </li>
        ))}
      </ul>
    </div>
  );
} 
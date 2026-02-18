"use client";

import React, { useEffect } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle 
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";

export type ImportStatus = "uploading" | "analyzing" | "mapping" | "complete";

interface ImportingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  status: ImportStatus;
  progress?: number;
}

export function ImportingDialog({ 
  open, 
  onOpenChange, 
  fileName, 
  status, 
  progress = 0 
}: ImportingDialogProps) {
  const isUploaded = status === "analyzing" || status === "mapping" || status === "complete";
  const isAnalyzed = status === "mapping" || status === "complete";
  const isComplete = status === "complete";

  
  // Force rerender to ensure dialog visibility
  useEffect(() => {
    if (open) {
      
      // Force a reflow to ensure dialog renders
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [open]);

  // Force the dialog to be non-dismissible during processing
  const handleOpenChange = (newOpen: boolean) => {
    
    // Only allow closing if process is complete or if explicitly trying to close
    if (status === "complete" || !newOpen) {
      onOpenChange(newOpen);
    }
  };

  if (!open) {
    
    return null;
  }

  return (
    <Dialog 
      open={open} 
      onOpenChange={handleOpenChange}
      // Force the dialog to stay on top
      modal={true}
    >
      <DialogContent 
        className="sm:max-w-md z-50 fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2"
        // Prevent closing when clicking outside
        onPointerDownOutside={(e) => {
          if (status !== "complete") {
            e.preventDefault();
          }
        }}
        // Prevent closing when pressing escape
        onEscapeKeyDown={(e) => {
          if (status !== "complete") {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Importing</DialogTitle>
          <div className="text-sm text-muted-foreground">
            {fileName}
          </div>
        </DialogHeader>
        
        <div className="py-6 space-y-6">
          {/* File Upload Step */}
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              {isUploaded ? (
                <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-600">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              ) : (
                <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
              )}
            </div>
            <div>
              <div className="font-medium">File Upload Complete</div>
              <div className="text-sm text-muted-foreground">Your file has been uploaded successfully</div>
            </div>
          </div>

          {/* Analysis Step */}
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              {isAnalyzed ? (
                <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-600">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              ) : status === "analyzing" ? (
                <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center animate-pulse">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                </div>
              ) : (
                <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <line x1="3" y1="9" x2="21" y2="9" />
                    <line x1="9" y1="21" x2="9" y2="9" />
                  </svg>
                </div>
              )}
            </div>
            <div>
              <div className="font-medium">Analysis Complete</div>
              <div className="text-sm text-muted-foreground">Excel File • Your file has been analyzed successfully</div>
            </div>
          </div>

          {/* Mapping Step */}
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0">
              {isComplete ? (
                <div className="h-8 w-8 rounded-full bg-green-100 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-green-600">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              ) : status === "mapping" ? (
                <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-600 animate-spin">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  </svg>
                </div>
              ) : (
                <div className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
                    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                  </svg>
                </div>
              )}
            </div>
            <div>
              <div className="font-medium">File Mapping Agent is processing</div>
              <div className="text-sm text-muted-foreground">
                The file is being configured. This may take a while,we will notify you when it's done.
              </div>
              {status === "mapping" && (
                <div className="mt-2">
                  <Progress value={progress} className="h-2 w-full" />
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
} 
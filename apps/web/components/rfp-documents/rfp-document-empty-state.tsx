'use client';

import React from 'react';
import { FolderOpen, Upload } from 'lucide-react';
import { PermissionButton } from '@/components/ui/permission-button';

interface RFPDocumentEmptyStateProps {
  onUpload: () => void;
}

export function RFPDocumentEmptyState({ onUpload }: RFPDocumentEmptyStateProps) {
  return (
    <div className="text-center py-10">
      <FolderOpen className="mx-auto h-9 w-9 text-muted-foreground mb-3" />
      <h3 className="text-lg font-medium">No RFP documents yet</h3>
      <p className="text-muted-foreground mt-1">
        Upload documents developed during the RFP process such as technical proposals, cost
        proposals, teaming agreements, and more.
      </p>
      <PermissionButton 
        className="mt-4" 
        requiredPermission="rfp_document:upload"
        onClick={onUpload}
      >
        <Upload className="h-4 w-4 mr-2" />
        Upload Your First Document
      </PermissionButton>
    </div>
  );
}

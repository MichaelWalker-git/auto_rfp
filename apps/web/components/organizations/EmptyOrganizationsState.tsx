'use client';

import React from 'react';
import { FolderOpen } from 'lucide-react';
import { PermissionButton } from '@/components/ui/permission-button';
import { BaseCard } from '@/components/ui/base-card';

interface EmptyOrganizationsStateProps {
  onCreateClick: () => void;
}

export function EmptyOrganizationsState({ onCreateClick }: EmptyOrganizationsStateProps) {
  return (
    <BaseCard
      title="No organizations yet"
      className="text-center p-8"
    >
      <div className="space-y-4">
        <FolderOpen className="mx-auto h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">
          Create your first organization to get started
        </p>
        <PermissionButton requiredPermission="org:create" onClick={onCreateClick}>
          Create Organization
        </PermissionButton>
      </div>
    </BaseCard>
  );
}
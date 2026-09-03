'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Users, FolderOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BaseCard } from '@/components/ui/base-card';
import { useCurrentOrganization } from '@/context/organization-context';
import type { OrganizationItem } from '@auto-rfp/core';
import { PermissionButton } from '@/components/ui/permission-button';
import { PermissionDeleteButton } from '@/components/ui/delete-button';
import { CreateEditOrganizationDialog } from '@/components/organizations/CreateEditOrganizationDialog';

interface OrganizationCardProps {
  organization: OrganizationItem;
  onDelete?: (org: OrganizationItem) => void;
  onUpdate?: (updatedOrganization: OrganizationItem) => void;
}

export function OrganizationCard({ organization, onDelete, onUpdate }: OrganizationCardProps) {
  const router = useRouter();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const { setCurrentOrganization } = useCurrentOrganization();

  // Guard against undefined or malformed organization data (AUTO-RFP-5V/5W)
  if (!organization || !organization.id) {
    return null;
  }

  const href = `/organizations/${organization.id}`;

  const handleOpen = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    setCurrentOrganization(organization);
    router.push(href);
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsEditDialogOpen(true);
  };

  // The card is wrapped in a Link. Without stopping the event here the click
  // bubbles up to handleOpen, which navigates into the organization and
  // unmounts the delete dialog before it can be confirmed.
  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDelete?.(organization);
  };

  return (
    <>
      <Link href={href} className="block" onClick={handleOpen}>
        <BaseCard
          title={organization.name || 'Unnamed Organization'}
          subtitle={organization.description}
          isHoverable
          actions={
            <>
              <PermissionButton
                requiredPermission="org:edit"
                variant="ghost"
                size="icon"
                className="rounded-xl"
                onClick={handleEditClick}
              >
                <Pencil className="h-3.5 w-3.5"/>
              </PermissionButton>

              <PermissionDeleteButton
                requiredPermission="org:delete"
                variant="ghost"
                size="icon"
                className="rounded-xl hover:bg-destructive/10 hover:text-destructive"
                onClick={handleDeleteClick}
                ariaLabel="Remove organization"
              />
            </>
          }
          footer={
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary" className="text-xs">
                <Users className="mr-1 h-3 w-3" />
                {organization._count?.organizationUsers ?? 0}
              </Badge>
              <Badge variant="secondary" className="text-xs">
                <FolderOpen className="mr-1 h-3 w-3" />
                {organization._count?.projects ?? 0}
              </Badge>
            </div>
          }
        />
      </Link>

      <CreateEditOrganizationDialog
        isOpen={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        organization={organization}
        onSuccess={onUpdate}
      />
    </>
  );
}
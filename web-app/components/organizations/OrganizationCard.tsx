'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Pencil, Trash2, Users, FolderOpen } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BaseCard } from '@/components/ui/base-card';
import { useCurrentOrganization } from '@/context/organization-context';
import type { Organization } from '@/app/organizations/page';
import PermissionWrapper from '../permission-wrapper';
import { CreateEditOrganizationDialog } from '@/components/organizations/CreateEditOrganizationDialog';

interface OrganizationCardProps {
  organization: Organization;
  onDelete?: (org: Organization) => void;
  onUpdate?: (updatedOrganization: Organization) => void;
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

  return (
    <>
      <Link href={href} className="block" onClick={handleOpen}>
        <BaseCard
          title={organization.name || 'Unnamed Organization'}
          subtitle={organization.description}
          isHoverable
          actions={
            <>
              <PermissionWrapper requiredPermission={'org:edit'}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-xl"
                  onClick={handleEditClick}
                  aria-label="Edit organization"
                  title="Edit organization"
                >
                  <Pencil className="h-3.5 w-3.5"/>
                </Button>
              </PermissionWrapper>

              <PermissionWrapper requiredPermission={'org:delete'}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-xl hover:bg-destructive/10 hover:text-destructive"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete?.(organization);
                  }}
                  aria-label="Remove organization"
                  title="Remove organization"
                >
                  <Trash2 className="h-3.5 w-3.5"/>
                </Button>
              </PermissionWrapper>
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
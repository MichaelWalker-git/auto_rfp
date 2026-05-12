'use client';

import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { AlertCircle } from 'lucide-react';
import { PermissionDeleteButton } from '@/components/ui/delete-button';

interface OrganizationDangerZoneProps {
  organizationName: string;
  onDelete: () => void;
}

export const OrganizationDangerZone: React.FC<OrganizationDangerZoneProps> = ({
  organizationName,
  onDelete,
}) => {
  return (
    <div className="space-y-4 pt-8">
      <Card className="border-destructive">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Irreversible and destructive actions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Warning</AlertTitle>
            <AlertDescription>
              Deleting an organization will permanently remove all projects, documents, and team members. This
              action cannot be undone.
            </AlertDescription>
          </Alert>

          <Separator className="my-4" />

          <div className="grid gap-4">
            <Label htmlFor="confirm">Type the organization name to confirm</Label>
            <Input
              id="confirm"
              placeholder={organizationName}
            />
          </div>
        </CardContent>
        <CardFooter>
          <PermissionDeleteButton
            requiredPermission="org:delete"
            variant="destructive"
            onClick={onDelete}
            showLabel
            label="Delete Organization"
          />
        </CardFooter>
      </Card>
    </div>
  );
};

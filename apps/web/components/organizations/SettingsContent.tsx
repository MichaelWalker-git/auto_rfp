'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { mutate as globalMutate } from 'swr';
import { useOrganization } from '@/lib/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, ArrowRight, Building2, Loader2, Settings2, Trash2, Upload } from 'lucide-react';
import Link from 'next/link';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PageHeader } from '@/components/layout/page-header';
import PermissionWrapper from '@/components/permission-wrapper';
import { SavedSearchList } from '@/components/organizations/SavedSearchList';
import { DocxTemplateUpload } from '@/components/organizations/DocxTemplateUpload';
import { ClusteringSettings } from '@/components/organizations/ClusteringSettings';
import { SamGovApiKeyConfiguration } from '@/components/api-key/SamGovApiKeyConfiguration';
import { LinearApiKeyConfiguration } from '@/components/api-key/LinearApiKeyConfiguration';
import { GoogleApiKeyConfiguration } from '@/components/api-key/GoogleApiKeyConfiguration';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import { usePresignUpload, uploadFileToS3 } from '@/lib/hooks/use-presign';
import Image from 'next/image';

interface SettingsContentProps {
  orgId: string;
}

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp'];
const MAX_ICON_SIZE = 2 * 1024 * 1024; // 2MB

export function SettingsContent({ orgId }: SettingsContentProps) {
  const [organization, setOrganization] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState('');
  const [iconUrl, setIconUrl] = useState('');
  const [iconS3Key, setIconS3Key] = useState('');
  const [isUploadingIcon, setIsUploadingIcon] = useState(false);
  const [isLoadingIcon, setIsLoadingIcon] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { trigger: presignUpload } = usePresignUpload();

  const { data: orgData, isLoading: isOrgLoading, isError: isOrgError, mutate } = useOrganization(orgId);

  useEffect(() => {
    if (orgData) {
      setOrganization(orgData);
      setName((orgData as any).name || '');
      // Load icon via presigned URL if org has an iconKey
      const orgIconKey = (orgData as any).iconKey;
      if (orgIconKey) {
        setIconS3Key(orgIconKey);
        loadIconPresignedUrl(orgIconKey);
      } else {
        setIconUrl('');
        setIconS3Key('');
      }
      setIsLoading(false);
    } else {
      setIsLoading(isOrgLoading);
    }

    if (isOrgError) {
      toast({
        title: 'Error',
        description: 'Failed to load organization data',
        variant: 'destructive',
      });
    }
  }, [orgData, isOrgLoading, isOrgError, toast]);

  // Force refresh of organization data when component mounts to ensure we have latest data
  useEffect(() => {
    mutate();
  }, [mutate]);

  const loadIconPresignedUrl = useCallback(async (key: string) => {
    try {
      setIsLoadingIcon(true);
      const res = await authFetcher(`${env.BASE_API_URL}/presigned/presigned-url`, {
        method: 'POST',
        body: JSON.stringify({ operation: 'download', key }),
      });
      if (res.ok) {
        const data = await res.json();
        setIconUrl(data.url);
      }
    } catch {
      // Silently fail — icon just won't show
    } finally {
      setIsLoadingIcon(false);
    }
  }, []);

  const handleIconUpload = useCallback(async (file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a PNG, JPEG, GIF, SVG, or WebP image.',
        variant: 'destructive',
      });
      return;
    }

    if (file.size > MAX_ICON_SIZE) {
      toast({
        title: 'File too large',
        description: 'Icon image must be less than 2MB.',
        variant: 'destructive',
      });
      return;
    }

    try {
      setIsUploadingIcon(true);

      // Get presigned URL for upload
      const presign = await presignUpload({
        fileName: file.name,
        contentType: file.type,
        prefix: `organizations/${orgId}/icon`,
      });

      // Upload file to S3
      await uploadFileToS3(presign.url, presign.method, file);

      // Store the S3 key for saving to the org record
      setIconS3Key(presign.key);

      // Get a presigned download URL for immediate display
      try {
        const iconRes = await authFetcher(`${env.BASE_API_URL}/presigned/presigned-url`, {
          method: 'POST',
          body: JSON.stringify({ operation: 'download', key: presign.key }),
        });
        if (iconRes.ok) {
          const iconData = await iconRes.json();
          setIconUrl(iconData.url);
        } else {
          setIconUrl('');
        }
      } catch {
        setIconUrl('');
      }

      toast({
        title: 'Icon uploaded',
        description: 'Click "Save Changes" to apply the new icon.',
      });
    } catch (error) {
      console.error('Error uploading icon:', error);
      toast({
        title: 'Upload failed',
        description: 'Failed to upload icon image. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsUploadingIcon(false);
    }
  }, [orgId, presignUpload, toast]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleIconUpload(file);
    }
    // Reset input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [handleIconUpload]);

  const handleRemoveIcon = useCallback(() => {
    setIconUrl('');
    toast({
      title: 'Icon removed',
      description: 'Click "Save Changes" to apply the change.',
    });
  }, [toast]);

  const handleUpdateOrganization = async (event: React.FormEvent) => {
    event.preventDefault();

    try {
      setIsSaving(true);

      const url = `${env.BASE_API_URL}/organization/edit-organization/${orgId}`;
      const response = await authFetcher(url, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          iconKey: iconS3Key || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update organization');
      }

      const updatedOrg = await response.json();
      setOrganization(updatedOrg);

      // Refresh local org SWR cache
      await mutate();

      // Force revalidate the global organizations list used by OrganizationContext
      // (sidebar, header, org switcher). The SWR key is an array ['organization/organizations']
      // and has dedupingInterval: 60s, so we must force revalidation.
      await globalMutate(
        (key: unknown) => Array.isArray(key) && key[0] === 'organization/organizations',
        undefined,
        { revalidate: true },
      );

      toast({
        title: 'Success',
        description: 'Organization settings updated',
      });
    } catch (error) {
      console.error('Error updating organization:', error);
      toast({
        title: 'Error',
        description: 'Failed to update organization settings',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteOrganization = () => {
    // This would typically open a confirmation dialog
    alert('This action would delete the organization. Not implemented in this demo.');
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-12">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-muted rounded"></div>
          <div className="h-32 bg-muted rounded"></div>
          <div className="h-64 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-12">
      <div className="flex flex-col gap-6">
        <PageHeader title="Organization Settings" description="Manage your organization configuration and integrations" />

          <SavedSearchList orgId={orgId}/>

          <SamGovApiKeyConfiguration orgId={orgId} />

          <GoogleApiKeyConfiguration orgId={orgId} />

          <LinearApiKeyConfiguration orgId={orgId} />

          {/* Prompts Management Link */}
          <Card className="hover:border-primary/50 transition-colors">
            <Link href={`/organizations/${orgId}/settings/prompts`}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    <Settings2 className="h-5 w-5" />
                    Prompts
                  </CardTitle>
                  <CardDescription>
                    Manage system and user prompts for AI-powered features
                  </CardDescription>
                </div>
                <ArrowRight className="h-5 w-5 text-muted-foreground" />
              </CardHeader>
            </Link>
          </Card>

          {/* DOCX Template Upload Section */}
          <DocxTemplateUpload orgId={orgId} />

          {/* Question Clustering Settings */}
          <ClusteringSettings orgId={orgId} />

          {/* General Settings Section */}
          <Card>
            <CardHeader>
              <CardTitle>General Settings</CardTitle>
              <CardDescription>
                Manage your organization's basic information
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdateOrganization} id="general-form">
                <div className="grid gap-6 py-2">
                  {/* Company Icon */}
                  <div className="grid gap-3">
                    <Label>Company Icon</Label>
                    <div className="flex items-start gap-4">
                      <div className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-muted-foreground/25 bg-muted/50">
                        {iconUrl ? (
                          <Image
                            src={iconUrl}
                            alt="Company icon"
                            width={80}
                            height={80}
                            className="h-full w-full object-contain"
                            unoptimized
                          />
                        ) : (
                          <Building2 className="h-8 w-8 text-muted-foreground/50" />
                        )}
                      </div>
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploadingIcon || isSaving}
                          >
                            {isUploadingIcon ? (
                              <>
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                Uploading...
                              </>
                            ) : (
                              <>
                                <Upload className="h-4 w-4 mr-2" />
                                Upload Icon
                              </>
                            )}
                          </Button>
                          {iconUrl && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={handleRemoveIcon}
                              disabled={isUploadingIcon || isSaving}
                              className="text-destructive hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Remove
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          PNG, JPEG, GIF, SVG, or WebP. Max 2MB. Recommended: 256×256px.
                        </p>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={ACCEPTED_IMAGE_TYPES.join(',')}
                        onChange={handleFileChange}
                        className="hidden"
                      />
                    </div>
                  </div>

                  {/* Organization Name */}
                  <div className="grid gap-2">
                    <Label htmlFor="name">Organization Name</Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter organization name"
                      required
                    />
                  </div>
                </div>
              </form>
            </CardContent>
            <CardFooter>
              <PermissionWrapper requiredPermission={'org:edit'}>
                <Button type="submit" form="general-form" disabled={isSaving}>
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </PermissionWrapper>
            </CardFooter>
          </Card>

          {/* Danger Zone Section */}
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
                  <AlertCircle className="h-4 w-4"/>
                  <AlertTitle>Warning</AlertTitle>
                  <AlertDescription>
                    Deleting an organization will permanently remove all projects, documents, and team members. This
                    action cannot be undone.
                  </AlertDescription>
                </Alert>

                <Separator className="my-4"/>

                <div className="grid gap-4">
                  <Label htmlFor="confirm">Type the organization name to confirm</Label>
                  <Input
                    id="confirm"
                    placeholder={organization?.name}
                  />
                </div>
              </CardContent>
              <PermissionWrapper requiredPermission={'org:delete'}>
                <CardFooter>
                  <Button
                    variant="destructive"
                    onClick={handleDeleteOrganization}
                  >
                    Delete Organization
                  </Button>
                </CardFooter>
              </PermissionWrapper>
            </Card>
        </div>
      </div>
    </div>
  );
}

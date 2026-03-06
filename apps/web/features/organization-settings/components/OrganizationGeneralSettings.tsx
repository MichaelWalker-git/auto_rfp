'use client';

import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Building2, Loader2, Trash2, Upload } from 'lucide-react';
import Image from 'next/image';

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml', 'image/webp'];

interface OrganizationGeneralSettingsProps {
  name: string;
  iconUrl: string;
  isUploadingIcon: boolean;
  isSaving: boolean;
  onNameChange: (name: string) => void;
  onIconUpload: (file: File) => void;
  onIconRemove: () => void;
  onSubmit: (event: React.FormEvent) => void;
}

export const OrganizationGeneralSettings: React.FC<OrganizationGeneralSettingsProps> = ({
  name,
  iconUrl,
  isUploadingIcon,
  isSaving,
  onNameChange,
  onIconUpload,
  onIconRemove,
  onSubmit,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onIconUpload(file);
    }
    // Reset input so the same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-slate-500/10 flex items-center justify-center shrink-0">
            <Building2 className="h-5 w-5 text-slate-500" />
          </div>
          <div>
            <CardTitle className="text-base">General Settings</CardTitle>
            <CardDescription className="text-xs mt-0.5">Organization profile</CardDescription>
          </div>
        </div>
      </CardHeader>

      <Separator />

      <form onSubmit={onSubmit} id="general-form">
        <CardContent className="pt-5 space-y-5">
          {/* Company Icon */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Company Icon
            </Label>
            <div className="flex items-center gap-4">
              <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted/50">
                {iconUrl ? (
                  <Image
                    src={iconUrl}
                    alt="Company icon"
                    width={64}
                    height={64}
                    className="h-full w-full object-contain"
                    unoptimized
                  />
                ) : (
                  <Building2 className="h-7 w-7 text-muted-foreground/40" />
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploadingIcon || isSaving}
                  >
                    {isUploadingIcon ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                        Uploading…
                      </>
                    ) : (
                      <>
                        <Upload className="h-3.5 w-3.5 mr-1.5" />
                        Upload
                      </>
                    )}
                  </Button>
                  {iconUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={onIconRemove}
                      disabled={isUploadingIcon || isSaving}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  PNG, JPEG, GIF, SVG, or WebP · Max 2MB
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
          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Organization Name
            </Label>
            <Input
              id="name"
              className="h-9 text-sm"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Enter organization name"
              required
            />
          </div>

          {/* Save button */}
          <div className="flex justify-end pt-1">
            <Button type="submit" size="sm" disabled={isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </div>
        </CardContent>
      </form>
    </Card>
  );
};

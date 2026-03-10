'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { useProject } from '@/lib/hooks/use-api';
import { useUpdateProject } from '@/lib/hooks/use-update-project';
import { Loader2, Save, UserCircle } from 'lucide-react';
import type { ProjectContactInfo } from '@auto-rfp/core';

interface ProjectContactSettingsProps {
  projectId: string;
  orgId: string;
}

export const ProjectContactSettings = ({ projectId, orgId }: ProjectContactSettingsProps) => {
  const { toast } = useToast();
  const { data: project, isLoading, mutate } = useProject(projectId);
  const { updateProject } = useUpdateProject();

  const [contactInfo, setContactInfo] = useState<ProjectContactInfo>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  // Sync form state when project data loads
  useEffect(() => {
    if (project?.contactInfo) {
      setContactInfo(project.contactInfo);
      setIsDirty(false);
    }
  }, [project?.contactInfo]);

  const handleChange = useCallback((field: keyof ProjectContactInfo, value: string) => {
    setContactInfo((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!project) return;

    try {
      setIsSaving(true);
      await updateProject({
        orgId,
        projectId,
        name: project.name,
        contactInfo,
      });
      await mutate();
      setIsDirty(false);
      toast({
        title: 'Contact info saved',
        description: 'Project contact information has been updated.',
      });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to save contact info',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  }, [project, orgId, projectId, contactInfo, updateProject, mutate, toast]);

  const hasContactInfo = contactInfo.primaryPocName || contactInfo.primaryPocEmail ||
    contactInfo.primaryPocPhone || contactInfo.primaryPocTitle;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCircle className="h-5 w-5" />
          Project Contact Information
        </CardTitle>
        <CardDescription>
          Primary point of contact for this project. Available as template variables{' '}
          <Badge variant="outline" className="font-mono text-xs mx-0.5">{'{{PROJECT_POC_NAME}}'}</Badge>,{' '}
          <Badge variant="outline" className="font-mono text-xs mx-0.5">{'{{PROJECT_POC_EMAIL}}'}</Badge>, etc.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="poc-name" className="text-sm">Primary POC Name</Label>
                <Input
                  id="poc-name"
                  value={contactInfo.primaryPocName || ''}
                  onChange={(e) => handleChange('primaryPocName', e.target.value)}
                  placeholder="John Smith"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="poc-title" className="text-sm">POC Title</Label>
                <Input
                  id="poc-title"
                  value={contactInfo.primaryPocTitle || ''}
                  onChange={(e) => handleChange('primaryPocTitle', e.target.value)}
                  placeholder="Proposal Manager"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="poc-email" className="text-sm">POC Email</Label>
                <Input
                  id="poc-email"
                  type="email"
                  value={contactInfo.primaryPocEmail || ''}
                  onChange={(e) => handleChange('primaryPocEmail', e.target.value)}
                  placeholder="john.smith@company.com"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="poc-phone" className="text-sm">POC Phone</Label>
                <Input
                  id="poc-phone"
                  value={contactInfo.primaryPocPhone || ''}
                  onChange={(e) => handleChange('primaryPocPhone', e.target.value)}
                  placeholder="+1 (555) 123-4567"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-muted-foreground">
                {hasContactInfo
                  ? 'Contact info will be used in document templates.'
                  : 'No contact info set. Template variables will be empty.'}
              </p>
              <Button
                onClick={handleSave}
                disabled={!isDirty || isSaving}
                size="sm"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save Contact Info
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

'use client';

import React, { useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, FolderOpen, Plus, X, Info } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useProjectKBs, useLinkKB, useUnlinkKB } from '@/lib/hooks/use-project-kbs';
import { useKnowledgeBases } from '@/lib/hooks/use-knowledgebase';
import { KnowledgeBase } from '@auto-rfp/core';

interface ProjectKBSettingsProps {
  projectId: string;
  orgId: string;
}

export function ProjectKBSettings({ projectId, orgId }: ProjectKBSettingsProps) {
  const { toast } = useToast();

  const { data: linkedKBs, isLoading: isLoadingLinks, mutate: mutateLinks } = useProjectKBs(projectId, orgId);
  const { data: allKBs, isLoading: isLoadingKBs } = useKnowledgeBases(orgId);

  const { trigger: linkKB, isMutating: isLinking } = useLinkKB();
  const { trigger: unlinkKB, isMutating: isUnlinking } = useUnlinkKB();

  const linkedKBIds = new Set((linkedKBs ?? []).map((l) => l.kbId));
  const isLoading = isLoadingLinks || isLoadingKBs;
  const isMutating = isLinking || isUnlinking;

  const handleLink = useCallback(async (kbId: string) => {
    try {
      await linkKB({ orgId, projectId, kbId });
      await mutateLinks();
      toast({ title: 'Folder assigned', description: 'Document folder has been assigned to this project.' });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to assign folder',
        variant: 'destructive',
      });
    }
  }, [projectId, orgId, linkKB, mutateLinks, toast]);

  const handleUnlink = useCallback(async (kbId: string) => {
    try {
      await unlinkKB({ orgId, projectId, kbId });
      await mutateLinks();
      toast({ title: 'Folder removed', description: 'Document folder has been removed from this project.' });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to remove folder',
        variant: 'destructive',
      });
    }
  }, [projectId, orgId, unlinkKB, mutateLinks, toast]);

  const linkedKBList = (allKBs ?? []).filter((kb: KnowledgeBase) => linkedKBIds.has(kb.id));
  const availableKBList = (allKBs ?? []).filter((kb: KnowledgeBase) => !linkedKBIds.has(kb.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5" />
          Org Document Folders
        </CardTitle>
        <CardDescription>
          Assign document folders to this project. Only assigned folders will be used for answer generation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Assigned folders */}
            {linkedKBList.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Assigned Folders</p>
                <div className="space-y-2">
                  {linkedKBList.map((kb: KnowledgeBase) => (
                    <div
                      key={kb.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <FolderOpen className="h-4 w-4 text-primary" />
                        <div>
                          <p className="text-sm font-medium">{kb.name}</p>
                          {kb.description && (
                            <p className="text-xs text-muted-foreground">{kb.description}</p>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleUnlink(kb.id)}
                        disabled={isMutating}
                        className="text-destructive hover:text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  No folders assigned. All organization document folders will be used for answer generation (default behavior).
                </AlertDescription>
              </Alert>
            )}

            {/* Available folders to add */}
            {availableKBList.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Available Folders</p>
                <div className="space-y-2">
                  {availableKBList.map((kb: KnowledgeBase) => (
                    <div
                      key={kb.id}
                      className="flex items-center justify-between rounded-lg border border-dashed p-3"
                    >
                      <div className="flex items-center gap-3">
                        <FolderOpen className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">{kb.name}</p>
                          {kb.description && (
                            <p className="text-xs text-muted-foreground">{kb.description}</p>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleLink(kb.id)}
                        disabled={isMutating}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(allKBs ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No document folders found in this organization. Create one first in the Org Documents section.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

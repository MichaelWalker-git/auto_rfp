'use client';

import React, { useCallback } from 'react';
import { mutate as globalMutate } from 'swr';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, Database, Plus, X, Info } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useProjectKBs, useLinkKB, useUnlinkKB } from '@/lib/hooks/use-project-kbs';
import { useKnowledgeBases } from '@/lib/hooks/use-knowledgebase';
import { KnowledgeBase } from '@auto-rfp/shared';

interface ProjectKBSettingsProps {
  projectId: string;
  orgId: string;
}

export function ProjectKBSettings({ projectId, orgId }: ProjectKBSettingsProps) {
  const { toast } = useToast();

  // Fetch linked KBs for this project
  const { data: linkedKBs, isLoading: isLoadingLinks, mutate: mutateLinks } = useProjectKBs(projectId);

  // Fetch all org KBs to show available ones
  const { data: allKBs, isLoading: isLoadingKBs } = useKnowledgeBases(orgId);

  // Mutation hooks
  const { trigger: linkKB, isMutating: isLinking } = useLinkKB();
  const { trigger: unlinkKB, isMutating: isUnlinking } = useUnlinkKB();

  const linkedKBIds = new Set((linkedKBs ?? []).map((l) => l.kbId));
  const isLoading = isLoadingLinks || isLoadingKBs;
  const isMutating = isLinking || isUnlinking;

  const handleLink = useCallback(async (kbId: string) => {
    try {
      await linkKB({ projectId, kbId });
      await mutateLinks();
      toast({ title: 'Knowledge base linked', description: 'KB has been assigned to this project.' });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to link knowledge base',
        variant: 'destructive',
      });
    }
  }, [projectId, linkKB, mutateLinks, toast]);

  const handleUnlink = useCallback(async (kbId: string) => {
    try {
      await unlinkKB({ projectId, kbId });
      await mutateLinks();
      toast({ title: 'Knowledge base unlinked', description: 'KB has been removed from this project.' });
    } catch (err) {
      toast({
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to unlink knowledge base',
        variant: 'destructive',
      });
    }
  }, [projectId, unlinkKB, mutateLinks, toast]);

  // Separate KBs into linked and available
  const linkedKBList = (allKBs ?? []).filter((kb: KnowledgeBase) => linkedKBIds.has(kb.id));
  const availableKBList = (allKBs ?? []).filter((kb: KnowledgeBase) => !linkedKBIds.has(kb.id));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Knowledge Bases
        </CardTitle>
        <CardDescription>
          Assign knowledge bases to this project. Only assigned KBs will be used for answer generation.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Linked KBs */}
            {linkedKBList.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Assigned Knowledge Bases</p>
                <div className="space-y-2">
                  {linkedKBList.map((kb: KnowledgeBase) => (
                    <div
                      key={kb.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex items-center gap-3">
                        <Database className="h-4 w-4 text-primary" />
                        <div>
                          <p className="text-sm font-medium">{kb.name}</p>
                          {kb.description && (
                            <p className="text-xs text-muted-foreground">{kb.description}</p>
                          )}
                        </div>
                        <Badge variant="secondary" className="text-xs">
                          {kb.type === 'CONTENT_LIBRARY' ? 'Q&A' : 'Documents'}
                        </Badge>
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
                  No knowledge bases assigned. All organization KBs will be used for answer generation (default behavior).
                </AlertDescription>
              </Alert>
            )}

            {/* Available KBs to add */}
            {availableKBList.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Available Knowledge Bases</p>
                <div className="space-y-2">
                  {availableKBList.map((kb: KnowledgeBase) => (
                    <div
                      key={kb.id}
                      className="flex items-center justify-between rounded-lg border border-dashed p-3"
                    >
                      <div className="flex items-center gap-3">
                        <Database className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium text-muted-foreground">{kb.name}</p>
                          {kb.description && (
                            <p className="text-xs text-muted-foreground">{kb.description}</p>
                          )}
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {kb.type === 'CONTENT_LIBRARY' ? 'Q&A' : 'Documents'}
                        </Badge>
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
                No knowledge bases found in this organization. Create one first in the Knowledge Base section.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

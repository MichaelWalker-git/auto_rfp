'use client';

import React, { useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Database, Loader2, Plus, X, Info } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/components/ui/use-toast';
import { grantKBAccessApi, revokeKBAccessApi, useUserKBAccess } from '@/lib/hooks/use-user';
import { useKnowledgeBases } from '@/lib/hooks/use-knowledgebase';
import { invalidateKBAccessCaches } from '@/lib/helpers/kb-access-cache';
import type { KnowledgeBase } from '@auto-rfp/shared';
import type { TeamMember } from './types';

// ────────────────────────────────────────────
// Types
// ────────────────────────────────────────────

interface ManageUserKBAccessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: TeamMember;
  orgId: string;
}

// ────────────────────────────────────────────
// Component
// ────────────────────────────────────────────

export function ManageUserKBAccessDialog({
  open,
  onOpenChange,
  member,
  orgId,
}: ManageUserKBAccessDialogProps) {
  const { toast } = useToast();
  const { data: allKBs = [], isLoading: isLoadingKBs } = useKnowledgeBases(orgId);
  const { data: accessData, isLoading: isLoadingAccess } = useUserKBAccess(open ? member.id : null, orgId);

  const [mutatingKbId, setMutatingKbId] = React.useState<string | null>(null);

  // Set of KB IDs this user currently has access to (from real API data)
  const grantedKBIds = useMemo(() => {
    const ids = new Set<string>();
    for (const record of accessData?.records ?? []) {
      ids.add(record.kbId);
    }
    return ids;
  }, [accessData]);

  const isLoading = isLoadingKBs || isLoadingAccess;

  const handleGrant = useCallback(async (kbId: string) => {
    setMutatingKbId(kbId);
    try {
      await grantKBAccessApi({ userId: member.id, kbId, orgId, accessLevel: 'read' });
      invalidateKBAccessCaches(member.id, kbId);
      toast({ title: 'Access granted', description: `${member.email} can now access this knowledge base.` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to grant access';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setMutatingKbId(null);
    }
  }, [member.id, member.email, orgId, toast]);

  const handleRevoke = useCallback(async (kbId: string) => {
    setMutatingKbId(kbId);
    try {
      await revokeKBAccessApi({ userId: member.id, kbId, orgId });
      invalidateKBAccessCaches(member.id, kbId);
      toast({ title: 'Access revoked', description: `${member.email} can no longer access this knowledge base.` });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to revoke access';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setMutatingKbId(null);
    }
  }, [member.id, member.email, orgId, toast]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Manage KB Access
          </DialogTitle>
          <DialogDescription>
            Control which knowledge bases <strong>{member.email}</strong> can access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : allKBs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No knowledge bases found in this organization.
            </p>
          ) : (
            <div className="space-y-2">
              <Label className="text-sm font-medium text-muted-foreground">
                Knowledge Bases ({grantedKBIds.size} of {allKBs.length} granted)
              </Label>
              {allKBs.map((kb: KnowledgeBase) => {
                const hasAccess = grantedKBIds.has(kb.id);
                const isMutating = mutatingKbId === kb.id;

                return (
                  <div
                    key={kb.id}
                    className={`flex items-center justify-between rounded-lg border p-3 ${
                      hasAccess ? 'border-primary/50 bg-primary/5' : 'border-dashed'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Database className={`h-4 w-4 ${hasAccess ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div>
                        <p className="text-sm font-medium">{kb.name}</p>
                        {kb.description && (
                          <p className="text-xs text-muted-foreground">{kb.description}</p>
                        )}
                      </div>
                      <Badge variant={hasAccess ? 'default' : 'outline'} className="text-xs">
                        {kb.type === 'CONTENT_LIBRARY' ? 'Q&A' : 'Documents'}
                      </Badge>
                    </div>
                    {hasAccess ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRevoke(kb.id)}
                        disabled={!!mutatingKbId}
                        className="text-destructive hover:text-destructive"
                      >
                        {isMutating ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleGrant(kb.id)}
                        disabled={!!mutatingKbId}
                      >
                        {isMutating ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <><Plus className="h-4 w-4 mr-1" /> Grant</>
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

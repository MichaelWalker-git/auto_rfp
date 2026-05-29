'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { BookOpen, Plus } from 'lucide-react';
import {
  useCreateKnowledgeBase,
  useDeleteKnowledgeBase,
  useEditKnowledgeBase,
  useKnowledgeBases
} from '@/lib/hooks/use-knowledgebase';
import PermissionWrapper from '@/components/permission-wrapper';
import { KnowledgeBase } from '@auto-rfp/core';
import { KBTypeSelect } from '@/components/kb/KBTypeSelect';
import KnowledgeBaseCard from '@/components/kb/KnowledgeBaseCard';
import { useCurrentOrganization } from '@/context/organization-context';

export function useOpenKnowledgeBase(orgId: string) {
  const router = useRouter();

  return (kb: KnowledgeBase) => {
    if (kb.type !== 'CONTENT_LIBRARY') {
      router.push(`/organizations/${orgId}/knowledge-base/${kb.id}`);
    } else {
      router.push(`/organizations/${orgId}/knowledge-base/${kb.id}/content-library`);
    }
  };
}

interface KnowledgeBaseContentProps {}

export function KnowledgeBaseContent({}: KnowledgeBaseContentProps) {
  const { orgId } = useParams() as { orgId: string };
  const { toast } = useToast();

  const [isCreateKBOpen, setIsCreateKBOpen] = useState(false);
  const [isEditKBOpen, setIsEditKBOpen] = useState(false);
  const [editingKb, setEditingKb] = useState<KnowledgeBase | null>(null);

  const [isDeleteKBOpen, setIsDeleteKBOpen] = useState(false);
  const [deletingKb, setDeletingKb] = useState<KnowledgeBase | null>(null);
  const { data: knowledgeBases, isLoading, mutate: mutateKb } = useKnowledgeBases(orgId);
  const { trigger: editKb } = useEditKnowledgeBase();
  const { trigger: deleteKb } = useDeleteKnowledgeBase();
  const { trigger: createKb } = useCreateKnowledgeBase(orgId);

  const [kbForm, setKbForm] = useState<Partial<KnowledgeBase>>({
    name: '',
    description: '',
    type: 'DOCUMENTS',
  });

  const openKnowledgeBase = useOpenKnowledgeBase(orgId);

  const resetForm = () => setKbForm({ name: '', description: '', type: 'DOCUMENTS' });

  const handleCreateKB = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await createKb(kbForm);
      await mutateKb();
      if (response.id) {
        toast({ title: 'Success', description: 'Knowledge base created successfully' });
        resetForm();
        setIsCreateKBOpen(false);
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to create knowledge base',
        variant: 'destructive',
      });
    }
  };

  const handleEditKB = (kb: KnowledgeBase) => {
    setEditingKb(kb);
    setKbForm({ name: kb.name, description: kb.description, type: kb.type });
    setIsEditKBOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingKb) return;

    try {
      await editKb({ kbId: editingKb.id, orgId: orgId, ...kbForm } as any);
      await mutateKb();
      toast({ title: 'Success', description: 'Knowledge base updated successfully' });

      setEditingKb(null);
      resetForm();
      setIsEditKBOpen(false);
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to update knowledge base',
        variant: 'destructive',
      });
    }
  };

  const handleAskDeleteKB = (kb: KnowledgeBase) => {
    setDeletingKb(kb);
    setIsDeleteKBOpen(true);
  };

  const handleConfirmDeleteKB = async () => {
    if (!deletingKb) return;

    try {
      await deleteKb({ ...deletingKb, orgId });
      await mutateKb();
      toast({ title: 'Success', description: 'Knowledge base deleted successfully' });

      setIsDeleteKBOpen(false);
      setDeletingKb(null);
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to delete knowledge base',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto p-12">
        <div className="space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/4 animate-pulse" />
          <div className="h-4 bg-gray-200 rounded w-1/2 animate-pulse" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-12">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <BookOpen className="h-8 w-8" />
            Knowledge Base
          </h1>
          <p className="text-gray-600 mt-1">
            Manage pre-built questions and answers for common RFP responses
          </p>
        </div>

        {/* Create dialog */}
        <Dialog
          open={isCreateKBOpen}
          onOpenChange={(open) => {
            setIsCreateKBOpen(open);
            if (!open) resetForm();
          }}
        >
          <PermissionWrapper requiredPermission={'kb:create'}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                New Knowledge Base
              </Button>
            </DialogTrigger>
          </PermissionWrapper>

          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Knowledge Base</DialogTitle>
              <DialogDescription>
                Create a new knowledge base to organize your questions and answers.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleCreateKB} className="space-y-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={kbForm.name}
                  onChange={(e) => setKbForm({ ...kbForm, name: e.target.value })}
                  placeholder="e.g., Technical Questions, Compliance, Pricing"
                  required
                />
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={kbForm?.description || ''}
                  onChange={(e) => setKbForm({ ...kbForm, description: e.target.value })}
                  placeholder="Describe what types of questions this knowledge base contains"
                />
              </div>

              <div>
                <KBTypeSelect
                  value={kbForm.type as any}
                  onChange={(type) => setKbForm({ ...kbForm, type })}
                  helperText="You can't change this later."
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsCreateKBOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Create</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Edit dialog */}
        <Dialog
          open={isEditKBOpen}
          onOpenChange={(open) => {
            setIsEditKBOpen(open);
            if (!open) {
              setEditingKb(null);
              resetForm();
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Knowledge Base</DialogTitle>
              <DialogDescription>Update the knowledge base details.</DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <Label htmlFor="edit-name">Name</Label>
                <Input
                  id="edit-name"
                  value={kbForm.name}
                  onChange={(e) => setKbForm({ ...kbForm, name: e.target.value })}
                  placeholder="e.g., Technical Questions, Compliance, Pricing"
                  required
                />
              </div>

              <div>
                <Label htmlFor="edit-description">Description</Label>
                <Textarea
                  id="edit-description"
                  value={kbForm?.description || ''}
                  onChange={(e) => setKbForm({ ...kbForm, description: e.target.value })}
                  placeholder="Describe what types of questions this knowledge base contains"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsEditKBOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">Save Changes</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete confirmation dialog */}
        <Dialog
          open={isDeleteKBOpen}
          onOpenChange={(open) => {
            setIsDeleteKBOpen(open);
            if (!open) setDeletingKb(null);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete knowledge base?</DialogTitle>
              <DialogDescription>
                This action cannot be undone. This will permanently delete{' '}
                <span className="font-medium text-foreground">
                  {deletingKb?.name ?? 'this knowledge base'}
                </span>
                .
              </DialogDescription>
            </DialogHeader>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsDeleteKBOpen(false);
                  setDeletingKb(null);
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleConfirmDeleteKB}
                disabled={!deletingKb}
              >
                Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {knowledgeBases?.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/10 px-12 py-20 mx-4 my-8">
          <div className="rounded-full bg-muted p-4 mb-6">
            <BookOpen className="h-10 w-10 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No knowledge bases yet</h3>
          <p className="text-muted-foreground text-center max-w-md mb-6">
            Knowledge bases help you organize pre-built questions and answers for common RFP responses.
            Create your first one to get started.
          </p>
          <PermissionWrapper requiredPermission="kb:create">
            <Button size="lg" onClick={() => setIsCreateKBOpen(true)}>
              <Plus className="mr-2 h-5 w-5" />
              Create Your First Knowledge Base
            </Button>
          </PermissionWrapper>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {knowledgeBases?.map((kb) => (
            <KnowledgeBaseCard
              kb={kb}
              key={kb?.id || ''}
              onOpen={openKnowledgeBase}
              onEdit={handleEditKB}
              onDelete={handleAskDeleteKB}
            />
          ))}
        </div>
      )}
    </div>
  );
}
'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { BookOpen, Plus } from 'lucide-react';
import { KnowledgeBase, useCreateKnowledgeBase, useKnowledgeBases } from '@/lib/hooks/use-knowledgebase';
import { useRouter } from 'next/navigation';

export function useOpenKnowledgeBase(orgId: string) {
  const router = useRouter();

  return (kbId: string) => {
    router.push(`/organizations/${orgId}/knowledge-base/${kbId}`);
  };
}

interface KnowledgeBaseContentProps {
  params: Promise<{
    orgId: string;
  }>;
}

export function KnowledgeBaseContent({ params }: KnowledgeBaseContentProps) {
  const { orgId } = useParams() as { orgId: string };
  const { toast } = useToast();

  // Dialog states
  const [isCreateKBOpen, setIsCreateKBOpen] = useState(false);
  const { data: knowledgeBases, isLoading, mutate: mutateKb } = useKnowledgeBases(orgId);
  const { trigger: createKb } = useCreateKnowledgeBase(orgId);
  const [kbForm, setKbForm] = useState({ name: '', description: '' });
  const openKnowledgeBase = useOpenKnowledgeBase(orgId);


  // Create knowledge base
  const handleCreateKB = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await createKb(kbForm);
      await mutateKb();
      if (response.id) {
        toast({
          title: 'Success',
          description: 'Knowledge base created successfully',
        });
        setKbForm({ name: '', description: '' });
        setIsCreateKBOpen(false);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to create knowledge base',
        variant: 'destructive',
      });
    }
  };


  if (isLoading) {
    return (
      <div className="container mx-auto p-12">
        <div className="space-y-6">
          <div className="h-8 bg-gray-200 rounded w-1/4 animate-pulse"/>
          <div className="h-4 bg-gray-200 rounded w-1/2 animate-pulse"/>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-32 bg-gray-200 rounded animate-pulse"/>
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
            <BookOpen className="h-8 w-8"/>
            Knowledge Base
          </h1>
          <p className="text-gray-600 mt-1">
            Manage pre-built questions and answers for common RFP responses
          </p>
        </div>
        <Dialog open={isCreateKBOpen} onOpenChange={setIsCreateKBOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4"/>
              New Knowledge Base
            </Button>
          </DialogTrigger>
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
                  value={kbForm.description}
                  onChange={(e) => setKbForm({ ...kbForm, description: e.target.value })}
                  placeholder="Describe what types of questions this knowledge base contains"
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
      </div>

      {knowledgeBases?.length === 0 ? (
        <div className="border rounded-lg p-8 text-center">
          <BookOpen className="mx-auto h-12 w-12 text-gray-400 mb-4"/>
          <h3 className="text-lg font-medium mb-2">No knowledge bases yet</h3>
          <p className="text-gray-600 mb-4">
            Create your first knowledge base to start building your question and answer library
          </p>
          <Button onClick={() => setIsCreateKBOpen(true)}>
            <Plus className="mr-2 h-4 w-4"/>
            Create Knowledge Base
          </Button>
        </div>
      ) : (

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {knowledgeBases?.map((kb) => (
            <Card
              key={kb.id}
              className={`cursor-pointer transition-all hover:shadow-md`}
              onClick={() => openKnowledgeBase(kb.id)}
            >
              <CardHeader>
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg">{kb.name}</CardTitle>
                  <Badge variant="secondary">
                    {kb._count.questions} questions
                  </Badge>
                </div>
                {kb.description && (
                  <CardDescription>{kb.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="text-sm text-gray-500">
                  Updated {new Date(kb.updatedAt).toLocaleDateString()}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

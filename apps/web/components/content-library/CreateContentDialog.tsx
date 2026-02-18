'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  useCreateContentLibraryItem,
  type ContentLibraryItem,
  type CreateContentLibraryItemDTO,
} from '@/lib/hooks/use-content-library';

interface CreateContentDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  kbId: string;
  categories: Array<{ name: string; count: number }>;
  onSuccess?: (item: ContentLibraryItem) => void;
}

export function CreateContentDialog({
  isOpen,
  onOpenChange,
  orgId,
  kbId,
  categories,
  onSuccess,
}: CreateContentDialogProps) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [category, setCategory] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const { toast } = useToast();
  const { create, isCreating } = useCreateContentLibraryItem();

  const resetForm = () => {
    setQuestion('');
    setAnswer('');
    setCategory('');
    setTagInput('');
    setTags([]);
    setDescription('');
  };

  const handleAddTag = () => {
    const trimmedTag = tagInput.trim().toLowerCase();
    if (trimmedTag && !tags.includes(trimmedTag) && tags.length < 20) {
      setTags([...tags, trimmedTag]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!question.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Question is required',
        variant: 'destructive',
      });
      return;
    }

    if (!answer.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Answer is required',
        variant: 'destructive',
      });
      return;
    }

    if (!category.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Category is required',
        variant: 'destructive',
      });
      return;
    }

    try {
      const data: CreateContentLibraryItemDTO = {
        orgId,
        kbId,
        question: question.trim(),
        answer: answer.trim(),
        category: category.trim(),
        tags: tags.length > 0 ? tags : undefined,
        description: description.trim() || undefined,
      };

      const newItem = await create(data);
      if (newItem) {
        toast({
          title: 'Success',
          description: 'Content item created successfully',
        });
        resetForm();
        onOpenChange(false);
        onSuccess?.(newItem);
      }
    } catch (error) {
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to create item',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Content Item</DialogTitle>
            <DialogDescription>
              Add a new question and answer to your content library for quick
              reuse.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="question">
                Question <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g., What is your company's experience with cloud deployments?"
                rows={2}
                required
                disabled={isCreating}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="answer">
                Answer <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Write your standard answer here..."
                rows={5}
                required
                disabled={isCreating}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="category">
                Category <span className="text-destructive">*</span>
              </Label>
              <Input
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g., Technical, Company Background, Security"
                list="category-suggestions"
                required
                disabled={isCreating}
              />
              <datalist id="category-suggestions">
                {categories.map((cat) => (
                  <option key={cat.name} value={cat.name} />
                ))}
              </datalist>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="tags">Tags (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="tags"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a tag and press Enter"
                  disabled={isCreating || tags.length >= 20}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAddTag}
                  disabled={isCreating || !tagInput.trim() || tags.length >= 20}
                >
                  Add
                </Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="cursor-pointer hover:bg-destructive/20"
                      onClick={() => handleRemoveTag(tag)}
                    >
                      {tag}
                      <X className="h-3 w-3 ml-1" />
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief notes about when to use this answer"
                disabled={isCreating}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                isCreating ||
                !question.trim() ||
                !answer.trim() ||
                !category.trim()
              }
            >
              {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isCreating ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

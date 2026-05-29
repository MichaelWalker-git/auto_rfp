'use client';

import { useState, useEffect } from 'react';
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
  useUpdateContentLibraryItem,
  type ContentLibraryItem,
  type UpdateContentLibraryItemDTO,
} from '@/lib/hooks/use-content-library';

interface EditContentDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  item: ContentLibraryItem | null;
  categories: Array<{ name: string; count: number }>;
  onSuccess?: () => void;
}

export function EditContentDialog({
  isOpen,
  onOpenChange,
  item,
  categories,
  onSuccess,
}: EditContentDialogProps) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [category, setCategory] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [changeNotes, setChangeNotes] = useState('');
  const { toast } = useToast();

  const { update, isUpdating } = useUpdateContentLibraryItem(
    item?.orgId || '',
    item?.kbId || '',
    item?.id || '',
  );

  useEffect(() => {
    if (item) {
      setQuestion(item.question);
      setAnswer(item.answer);
      setCategory(item.category);
      setTags(item.tags || []);
      setDescription(item.description || '');
      setChangeNotes('');
    }
  }, [item]);

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

    if (!item) return;

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
      const data: UpdateContentLibraryItemDTO = {
        question: question.trim(),
        answer: answer.trim(),
        category: category.trim(),
        tags,
        description: description.trim() || undefined,
        changeNotes: changeNotes.trim() || undefined,
      };

      await update(data);
      toast({
        title: 'Success',
        description: 'Content item updated successfully',
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to update item',
        variant: 'destructive',
      });
    }
  };

  if (!item) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Content Item</DialogTitle>
            <DialogDescription>
              Update the question and answer. Changes will create a new version.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-question">
                Question <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="edit-question"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                rows={2}
                required
                disabled={isUpdating}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-answer">
                Answer <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="edit-answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={5}
                required
                disabled={isUpdating}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-category">
                Category <span className="text-destructive">*</span>
              </Label>
              <Input
                id="edit-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                list="edit-category-suggestions"
                required
                disabled={isUpdating}
              />
              <datalist id="edit-category-suggestions">
                {categories.map((cat) => (
                  <option key={cat.name} value={cat.name} />
                ))}
              </datalist>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-tags">Tags (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="edit-tags"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Type a tag and press Enter"
                  disabled={isUpdating || tags.length >= 20}
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleAddTag}
                  disabled={isUpdating || !tagInput.trim() || tags.length >= 20}
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
                      onClick={() => !isUpdating && handleRemoveTag(tag)}
                    >
                      {tag}
                      <X className="h-3 w-3 ml-1" />
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-description">Description (optional)</Label>
              <Input
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief notes about when to use this answer"
                disabled={isUpdating}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="change-notes">Change Notes (optional)</Label>
              <Input
                id="change-notes"
                value={changeNotes}
                onChange={(e) => setChangeNotes(e.target.value)}
                placeholder="Describe what changed in this update"
                disabled={isUpdating}
              />
              <p className="text-xs text-muted-foreground">
                Version {item.currentVersion} &rarr; Version{' '}
                {item.currentVersion + 1}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                isUpdating ||
                !question.trim() ||
                !answer.trim() ||
                !category.trim()
              }
            >
              {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isUpdating ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

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
import { Loader2, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  useCreateContentLibraryItem,
  type ContentLibraryItem,
  type CreateContentLibraryItemDTO,
} from '@/lib/hooks/use-content-library';

interface CreateContentDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  kbId?: string;
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

  const handleClose = () => {
    if (!isCreating) {
      resetForm();
      onOpenChange(false);
    }
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

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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
        toast({ title: 'Q&A item added successfully' });
        resetForm();
        onOpenChange(false);
        onSuccess?.(newItem);
      }
    } catch (error) {
      toast({
        title: 'Failed to create item',
        description: error instanceof Error ? error.message : 'Please try again',
        variant: 'destructive',
      });
    }
  };

  const isValid = question.trim().length > 0 && answer.trim().length > 0 && category.trim().length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="pb-2">
            <DialogTitle className="text-xl">Add Q&amp;A Item</DialogTitle>
            <DialogDescription>
              Add a reusable question and answer to your Q&amp;A Library.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            {/* Question */}
            <div className="space-y-2">
              <Label htmlFor="question" className="text-sm font-medium">
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
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                The RFP question or prompt this answer addresses.
              </p>
            </div>

            {/* Answer */}
            <div className="space-y-2">
              <Label htmlFor="answer" className="text-sm font-medium">
                Answer <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Write your standard answer here. This will be reused across proposals."
                rows={6}
                required
                disabled={isCreating}
                className="resize-none"
              />
              <p className="text-xs text-muted-foreground">
                {answer.length} characters · Starts as <span className="font-medium text-yellow-700">Draft</span> — approve when ready to use.
              </p>
            </div>

            <Separator />

            {/* Category */}
            <div className="space-y-2">
              <Label htmlFor="category" className="text-sm font-medium">
                Category <span className="text-destructive">*</span>
              </Label>
              <Input
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g., Technical, Company Background, Security, Pricing"
                list="category-suggestions"
                required
                disabled={isCreating}
              />
              <datalist id="category-suggestions">
                {categories.map((cat) => (
                  <option key={cat.name} value={cat.name} />
                ))}
              </datalist>
              {categories.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {categories.slice(0, 6).map((cat) => (
                    <button
                      key={cat.name}
                      type="button"
                      onClick={() => setCategory(cat.name)}
                      disabled={isCreating}
                      className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                        category === cat.name
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-muted text-muted-foreground border-border hover:bg-muted/80'
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Tags */}
            <div className="space-y-2">
              <Label htmlFor="tags" className="text-sm font-medium">
                Tags <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <div className="flex gap-2">
                <Input
                  id="tags"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  placeholder="Type a tag and press Enter or comma"
                  disabled={isCreating || tags.length >= 20}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleAddTag}
                  disabled={isCreating || !tagInput.trim() || tags.length >= 20}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="cursor-pointer gap-1 hover:bg-destructive/10 hover:text-destructive transition-colors"
                      onClick={() => handleRemoveTag(tag)}
                    >
                      {tag}
                      <X className="h-3 w-3" />
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium">
                Usage notes <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="When to use this answer, any caveats or context..."
                disabled={isCreating}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating || !isValid}>
              {isCreating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Q&amp;A
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

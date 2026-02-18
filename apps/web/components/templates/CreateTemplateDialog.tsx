'use client';

import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useCreateTemplate, type TemplateSection } from '@/lib/hooks/use-templates';

const CATEGORIES = [
  { value: 'TECHNICAL_PROPOSAL', label: 'Technical Proposal' },
  { value: 'MANAGEMENT_PROPOSAL', label: 'Management Proposal' },
  { value: 'PAST_PERFORMANCE', label: 'Past Performance' },
  { value: 'PRICE_VOLUME', label: 'Price Volume' },
  { value: 'EXECUTIVE_SUMMARY', label: 'Executive Summary' },
  { value: 'CERTIFICATIONS', label: 'Certifications' },
  { value: 'CUSTOM', label: 'Custom' },
];

interface CreateTemplateDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  onSuccess?: () => void;
}

const createEmptySection = (order: number): TemplateSection => ({
  id: uuidv4(),
  title: '',
  content: '',
  order,
  required: true,
});

export function CreateTemplateDialog({
  isOpen,
  onOpenChange,
  orgId,
  onSuccess,
}: CreateTemplateDialogProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [sections, setSections] = useState<TemplateSection[]>([createEmptySection(0)]);

  const { toast } = useToast();
  const { create, isCreating } = useCreateTemplate();

  const resetForm = () => {
    setName('');
    setCategory('');
    setDescription('');
    setSections([createEmptySection(0)]);
  };

  const handleAddSection = () => {
    setSections((prev) => [...prev, createEmptySection(prev.length)]);
  };

  const handleRemoveSection = (idx: number) => {
    setSections((prev) =>
      prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i })),
    );
  };

  const handleSectionChange = (
    idx: number,
    field: 'title' | 'content' | 'description',
    value: string,
  ) => {
    setSections((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !category) {
      toast({ title: 'Name and category are required', variant: 'destructive' });
      return;
    }

    const validSections = sections.filter((s) => s.title.trim());
    if (validSections.length === 0) {
      toast({ title: 'At least one section with a title is required', variant: 'destructive' });
      return;
    }

    try {
      await create({
        orgId,
        name: name.trim(),
        type: category,
        category,
        description: description.trim() || undefined,
        sections: validSections.map((s, i) => ({
          ...s,
          order: i,
          content: s.content || `{{company_name}} will provide details for ${s.title}...`,
        })),
      });
      resetForm();
      onSuccess?.();
    } catch (err) {
      toast({
        title: 'Failed to create template',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Template</DialogTitle>
            <DialogDescription>
              Define a reusable template with sections and macro placeholders.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Technical Proposal - DoD"
                disabled={isCreating}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="category">
                Category <span className="text-destructive">*</span>
              </Label>
              <Select value={category} onValueChange={setCategory} disabled={isCreating}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this template..."
                rows={2}
                disabled={isCreating}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Sections</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddSection}
                  disabled={isCreating}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Section
                </Button>
              </div>

              {sections.map((section, idx) => (
                <div key={section.id} className="border rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-mono w-6">
                      {idx + 1}.
                    </span>
                    <Input
                      value={section.title}
                      onChange={(e) => handleSectionChange(idx, 'title', e.target.value)}
                      placeholder="Section title"
                      className="flex-1"
                      disabled={isCreating}
                    />
                    {sections.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => handleRemoveSection(idx)}
                        disabled={isCreating}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  <Textarea
                    value={section.content}
                    onChange={(e) => handleSectionChange(idx, 'content', e.target.value)}
                    placeholder="Section content with {{macro}} placeholders..."
                    rows={3}
                    className="text-sm"
                    disabled={isCreating}
                  />
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Use {'{{macro_name}}'} syntax for placeholders. System macros like{' '}
              {'{{company_name}}'}, {'{{project_title}}'}, {'{{agency_name}}'} are
              auto-populated when applying.
            </p>
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
            <Button type="submit" disabled={isCreating || !name.trim() || !category}>
              {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isCreating ? 'Creating...' : 'Create Template'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
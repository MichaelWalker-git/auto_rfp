'use client';

import { useState, useEffect } from 'react';
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
import { useUpdateTemplate, type TemplateItem, type TemplateSection } from '@/lib/hooks/use-templates';

const CATEGORIES = [
  { value: 'TECHNICAL_PROPOSAL', label: 'Technical Proposal' },
  { value: 'MANAGEMENT_PROPOSAL', label: 'Management Proposal' },
  { value: 'PAST_PERFORMANCE', label: 'Past Performance' },
  { value: 'PRICE_VOLUME', label: 'Price Volume' },
  { value: 'EXECUTIVE_SUMMARY', label: 'Executive Summary' },
  { value: 'CERTIFICATIONS', label: 'Certifications' },
  { value: 'CUSTOM', label: 'Custom' },
];

interface EditTemplateDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  template: TemplateItem | null;
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

export function EditTemplateDialog({
  isOpen,
  onOpenChange,
  template,
  orgId,
  onSuccess,
}: EditTemplateDialogProps) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [sections, setSections] = useState<TemplateSection[]>([]);

  const { toast } = useToast();
  const { update, isUpdating } = useUpdateTemplate(orgId, template?.id ?? '');

  // Sync form state when template changes or dialog opens
  useEffect(() => {
    if (template && isOpen) {
      setName(template.name);
      setCategory(template.category);
      setDescription(template.description ?? '');
      setSections(
        template.sections.length > 0
          ? template.sections.map((s, i) => ({ ...s, order: i }))
          : [createEmptySection(0)],
      );
    }
  }, [template, isOpen]);

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

    if (!template || !name.trim() || !category) {
      toast({ title: 'Name and category are required', variant: 'destructive' });
      return;
    }

    const validSections = sections.filter((s) => s.title.trim());
    if (validSections.length === 0) {
      toast({ title: 'At least one section with a title is required', variant: 'destructive' });
      return;
    }

    try {
      await update({
        name: name.trim(),
        type: category,
        category,
        description: description.trim() || undefined,
        sections: validSections.map((s, i) => ({ ...s, order: i })),
      });
      toast({ title: 'Template updated', description: `"${name.trim()}" has been saved.` });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({
        title: 'Failed to update template',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  if (!template) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Template</DialogTitle>
            <DialogDescription>
              Update the template sections and metadata.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Technical Proposal - DoD"
                disabled={isUpdating}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-category">
                Category <span className="text-destructive">*</span>
              </Label>
              <Select value={category} onValueChange={setCategory} disabled={isUpdating}>
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
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this template..."
                rows={2}
                disabled={isUpdating}
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
                  disabled={isUpdating}
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
                      disabled={isUpdating}
                    />
                    {sections.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => handleRemoveSection(idx)}
                        disabled={isUpdating}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  <Textarea
                    value={section.content}
                    onChange={(e) => handleSectionChange(idx, 'content', e.target.value)}
                    placeholder="Section content with {{macro}} placeholders..."
                    rows={4}
                    className="text-sm"
                    disabled={isUpdating}
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
              disabled={isUpdating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isUpdating || !name.trim() || !category}>
              {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isUpdating ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
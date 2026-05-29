'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save, X } from 'lucide-react';

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
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { RichTextEditor } from '@/components/rfp-documents/rich-text-editor';
import { useUpdateTemplate, type TemplateItem } from '@/lib/hooks/use-templates';

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { value: 'COVER_LETTER', label: 'Cover Letter' },
  { value: 'EXECUTIVE_SUMMARY', label: 'Executive Summary' },
  { value: 'UNDERSTANDING_OF_REQUIREMENTS', label: 'Understanding of Requirements' },
  { value: 'TECHNICAL_PROPOSAL', label: 'Technical Proposal' },
  { value: 'PROJECT_PLAN', label: 'Project Plan' },
  { value: 'TEAM_QUALIFICATIONS', label: 'Team Qualifications' },
  { value: 'PAST_PERFORMANCE', label: 'Past Performance' },
  { value: 'COST_PROPOSAL', label: 'Cost Proposal' },
  { value: 'MANAGEMENT_APPROACH', label: 'Management Approach' },
  { value: 'RISK_MANAGEMENT', label: 'Risk Management' },
  { value: 'COMPLIANCE_MATRIX', label: 'Compliance Matrix' },
  { value: 'CERTIFICATIONS', label: 'Certifications' },
  { value: 'APPENDICES', label: 'Appendices' },
  { value: 'MANAGEMENT_PROPOSAL', label: 'Management Proposal' },
  { value: 'PRICE_VOLUME', label: 'Price Volume' },
  { value: 'QUALITY_MANAGEMENT', label: 'Quality Management Plan' },
  { value: 'CUSTOM', label: 'Custom' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface EditTemplateDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  template: TemplateItem | null;
  orgId: string;
  onSuccess?: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

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
  const [content, setContent] = useState('');

  const { toast } = useToast();
  const { update, isUpdating } = useUpdateTemplate(orgId, template?.id ?? '');

  // Sync form state when template changes or dialog opens
  useEffect(() => {
    if (template && isOpen) {
      setName(template.name);
      setCategory(template.category);
      setDescription(template.description ?? '');
      // Read content from the first section (canonical storage)
      const firstSection = template.sections.sort((a, b) => a.order - b.order)[0];
      setContent(firstSection?.content ?? '');
    }
  }, [template, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!template || !name.trim() || !category) {
      toast({ title: 'Name and category are required', variant: 'destructive' });
      return;
    }

    try {
      await update({
        name: name.trim(),
        type: category,
        category,
        description: description.trim() || undefined,
        // Preserve the single-section structure, updating content
        sections: [
          {
            ...(template.sections[0] ?? { id: template.id, order: 0, required: true }),
            title: name.trim(),
            content,
            order: 0,
            required: true,
          },
        ],
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
    <Dialog open={isOpen} onOpenChange={(open) => { if (!isUpdating) onOpenChange(open); }}>
      <DialogContent className="flex flex-col !w-[85vw] !max-w-none h-[92vh]">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          {/* ── Header ── */}
          <DialogHeader className="shrink-0">
            <DialogTitle>Edit Template</DialogTitle>
            <DialogDescription>
              Update the template content and metadata.
              Use{' '}
              <code className="text-xs bg-muted px-1 rounded">{'{{macro}}'}</code>{' '}
              placeholders for dynamic values like{' '}
              <code className="text-xs bg-muted px-1 rounded">company_name</code>,{' '}
              <code className="text-xs bg-muted px-1 rounded">agency_name</code>,{' '}
              <code className="text-xs bg-muted px-1 rounded">project_title</code>.
            </DialogDescription>
          </DialogHeader>

          <Separator className="shrink-0 my-3" />

          {/* ── Metadata row ── */}
          <div className="shrink-0 grid grid-cols-3 gap-3 mb-3">
            <div className="space-y-1.5">
              <Label htmlFor="et-name">Name *</Label>
              <Input
                id="et-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Technical Proposal — DoD"
                disabled={isUpdating}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="et-category">Category *</Label>
              <Select value={category} onValueChange={setCategory} disabled={isUpdating}>
                <SelectTrigger id="et-category">
                  <SelectValue placeholder="Select category…" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="et-desc">Description</Label>
              <Textarea
                id="et-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this template…"
                rows={1}
                disabled={isUpdating}
                className="resize-none"
              />
            </div>
          </div>

          {/* ── Content editor ── */}
          <div className="flex-1 min-h-0 flex flex-col space-y-1.5">
            <Label className="shrink-0">
              Template Content{' '}
              <span className="text-xs text-muted-foreground font-normal">
                (HTML — structure with headings, use {'{{macro}}'} for placeholders)
              </span>
            </Label>
            <RichTextEditor
              value={content}
              onChange={setContent}
              disabled={isUpdating}
              className="flex-1 min-h-0"
              minHeight="calc(92vh - 280px)"
            />
          </div>

          {/* ── Footer ── */}
          <Separator className="shrink-0 mt-3" />
          <DialogFooter className="shrink-0 pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isUpdating}
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button type="submit" disabled={isUpdating || !name.trim() || !category}>
              {isUpdating ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
              ) : (
                <><Save className="mr-2 h-4 w-4" />Save Changes</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

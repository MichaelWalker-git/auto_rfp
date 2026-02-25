'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Save, X } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { RichTextEditor, stripPresignedUrlsFromHtml } from '@/components/rfp-documents/rich-text-editor';
import { useUpdateTemplate, useTemplate, type TemplateItem } from '@/lib/hooks/use-templates';
import { usePresignUpload, usePresignDownload, uploadFileToS3 } from '@/lib/hooks/use-presign';
import type { Editor } from '@tiptap/react';

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

/** Predefined system variables users can insert into template content */
const SYSTEM_VARIABLES = [
  { key: 'TODAY',           label: "Today's Date" },
  { key: 'COMPANY_NAME',    label: 'Company Name' },
  { key: 'AGENCY_NAME',     label: 'Agency Name' },
  { key: 'PROJECT_TITLE',   label: 'Project Title' },
  { key: 'CONTENT',         label: 'Content' },
  { key: 'CONTRACT_NUMBER', label: 'Contract #' },
  { key: 'SUBMISSION_DATE', label: 'Submission Date' },
  { key: 'PROPOSAL_TITLE',  label: 'Proposal Title' },
  { key: 'OPPORTUNITY_ID',  label: 'Opportunity ID' },
  { key: 'PAGE_LIMIT',      label: 'Page Limit' },
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
  const [content, setContent] = useState('');
  const [isImageUploading, setIsImageUploading] = useState(false);
  const [isResolvingImages, setIsResolvingImages] = useState(false);
  const contentInitializedRef = useRef(false);
  const editorRef = useRef<Editor | null>(null);

  const { toast } = useToast();
  const { update, isUpdating } = useUpdateTemplate(orgId, template?.id ?? '');
  const { trigger: triggerPresignUpload } = usePresignUpload();
  const { trigger: triggerPresignDownload } = usePresignDownload();

  // Fetch the full template (with S3-loaded htmlContent) when dialog opens
  const { template: fullTemplate, isLoading: isLoadingContent } = useTemplate(
    isOpen && template ? orgId : null,
    isOpen && template ? template.id : null,
  );

  // Sync metadata from the list template immediately (fast)
  useEffect(() => {
    if (!template || !isOpen) {
      contentInitializedRef.current = false;
      setContent('');
      setIsResolvingImages(false);
      return;
    }
    setName(template.name);
    setCategory(template.category);
  }, [template, isOpen]);

  // Sync content once the full template (with htmlContent from S3) is loaded
  // Resolve s3key: placeholders to presigned URLs for display
  useEffect(() => {
    if (!fullTemplate || !isOpen || contentInitializedRef.current) return;

    const rawContent = fullTemplate.htmlContent ?? '';

    // If content has s3key: placeholders, resolve them to presigned URLs for display
    const s3KeyMatches = [...rawContent.matchAll(/src="s3key:([^"]+)"/g)];
    if (s3KeyMatches.length === 0) {
      contentInitializedRef.current = true;
      setContent(rawContent);
      return;
    }

    // Resolve all s3key: placeholders in parallel
    setIsResolvingImages(true);
    const resolveImages = async () => {
      let resolved = rawContent;
      await Promise.all(
        s3KeyMatches.map(async ([, key]) => {
          try {
            const presign = await triggerPresignDownload({ key });
            // Replace src="s3key:KEY" with presigned URL; data-s3-key stays for stripPresignedUrlsFromHtml on save
            resolved = resolved.split(`src="s3key:${key}"`).join(`src="${presign.url}"`);
          } catch {
            console.warn(`Failed to resolve s3key: ${key}`);
          }
        }),
      );
      contentInitializedRef.current = true;
      setContent(resolved);
      setIsResolvingImages(false);
    };

    resolveImages();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullTemplate?.id, isOpen]);

  /** Insert {{KEY}} at the current cursor position in the editor */
  const insertMacro = (key: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.chain().focus().insertContent(`{{${key}}}`).run();
  };

  /** Upload image to S3 via presigned URL — same pattern as RFP document editor */
  const handleUploadImageToS3 = useCallback(async (file: File): Promise<string> => {
    const prefix = `${orgId}/template-images`;
    const presign = await triggerPresignUpload({ fileName: file.name, contentType: file.type, prefix });
    await uploadFileToS3(presign.url, presign.method, file);
    return presign.key;
  }, [orgId, triggerPresignUpload]);

  /** Get presigned download URL for an S3 key */
  const handleGetDownloadUrl = useCallback(async (key: string): Promise<string> => {
    const presign = await triggerPresignDownload({ key });
    return presign.url;
  }, [triggerPresignDownload]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!template || !name.trim() || !category) {
      toast({ title: 'Name and category are required', variant: 'destructive' });
      return;
    }

    try {
      // Strip presigned URLs → s3key: placeholders before saving (same as RFP editor)
      const cleanContent = stripPresignedUrlsFromHtml(content);

      await update({
        name: name.trim(),
        type: category,
        category,
        htmlContent: cleanContent,
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

  const isDisabled = isUpdating || isLoadingContent || isResolvingImages;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!isUpdating) onOpenChange(open); }}>
      <DialogContent className="flex flex-col !w-[85vw] !max-w-none h-[92vh]">
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          {/* ── Header ── */}
          <DialogHeader className="shrink-0">
            <DialogTitle>Edit Template</DialogTitle>
          </DialogHeader>

          <Separator className="shrink-0 my-3" />

          {/* ── Metadata row ── */}
          <div className="shrink-0 grid grid-cols-2 gap-3 mb-3">
            <div className="space-y-1.5">
              <Label htmlFor="et-name">Name *</Label>
              <Input
                id="et-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Technical Proposal — DoD"
                disabled={isDisabled}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="et-category">Category *</Label>
              <Select value={category} onValueChange={setCategory} disabled={isDisabled}>
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
          </div>

          {/* ── Macro insertion bar ── */}
          <div className="shrink-0 mb-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-medium shrink-0">Insert variable:</span>
              {SYSTEM_VARIABLES.map(({ key }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => insertMacro(key)}
                  disabled={isDisabled}
                  className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-medium bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title={`Insert {{${key}}}`}
                >
                  {`{{${key}}}`}
                </button>
              ))}
            </div>
          </div>

          {/* ── Content editor ── */}
          <div className="flex-1 min-h-0 flex flex-col space-y-1.5">
            <Label className="shrink-0">
              Template Content{' '}
              <span className="text-xs text-muted-foreground font-normal">
                (HTML — click a variable above to insert it at cursor position)
              </span>
            </Label>
            {isLoadingContent || isResolvingImages ? (
              <div className="flex-1 flex items-center justify-center bg-gray-100 rounded-md">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading template content…
                </div>
              </div>
            ) : (
              <RichTextEditor
                key={template.id}
                value={content}
                onChange={setContent}
                disabled={isUpdating}
                className="flex-1 min-h-0"
                minHeight="calc(92vh - 260px)"
                onUploadImageToS3={handleUploadImageToS3}
                onGetDownloadUrl={handleGetDownloadUrl}
                onUploadingChange={setIsImageUploading}
                onEditorReady={(editor) => { editorRef.current = editor; }}
              />
            )}
          </div>

          {/* ── Footer ── */}
          <Separator className="shrink-0 mt-3" />
          <DialogFooter className="shrink-0 pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isDisabled}
            >
              <X className="h-4 w-4 mr-2" />
              Cancel
            </Button>
            <Button type="submit" disabled={isDisabled || isImageUploading || !name.trim() || !category}>
              {isUpdating ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
              ) : isLoadingContent ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading…</>
              ) : isImageUploading ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading image…</>
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

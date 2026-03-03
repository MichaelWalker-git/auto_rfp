'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Save, X } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/use-toast';

import {
  type RFPDocumentItem,
  type RFPDocumentType,
  RFP_DOCUMENT_TYPES,
  useUpdateRFPDocument,
  useRFPDocumentHtmlContent,
} from '@/lib/hooks/use-rfp-documents';
import { RichTextEditor, stripPresignedUrlsFromHtml } from './rich-text-editor';
import {
  usePresignUpload,
  usePresignDownload,
  uploadFileToS3,
} from '@/lib/hooks/use-presign';

// ─── Form schema ──────────────────────────────────────────────────────────────

const MetadataSchema = z.object({
  name: z.string().min(1, 'Document name is required').max(200),
  description: z.string().max(1000).optional(),
  documentType: z.string().min(1, 'Document type is required'),
  title: z.string().max(300).optional(),
  customerName: z.string().max(200).optional(),
  outlineSummary: z.string().max(2000).optional(),
});

type MetadataFormValues = z.input<typeof MetadataSchema>;

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: RFPDocumentItem | null;
  orgId: string;
  onSuccess?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isContentDocument = (doc: RFPDocumentItem): boolean =>
  !!(doc.content || doc.htmlContentKey);

// ─── Sub-components ───────────────────────────────────────────────────────────

const DocumentTypeBadge = ({ type }: { type: string }) => (
  <Badge variant="outline" className="text-xs font-normal">
    <FileText className="h-3 w-3 mr-1" />
    {RFP_DOCUMENT_TYPES[type as RFPDocumentType] ?? type}
  </Badge>
);

// ─── Main component ───────────────────────────────────────────────────────────

export const RFPDocumentEditDialog = ({
  open,
  onOpenChange,
  document: doc,
  orgId,
  onSuccess,
}: Props) => {
  const { trigger: updateDocument, isMutating } = useUpdateRFPDocument(orgId);
  const { toast } = useToast();

  // ── Presign hooks for image upload/download ──
  const { trigger: triggerPresignUpload } = usePresignUpload();
  const { trigger: triggerPresignDownload } = usePresignDownload();

  const handleUploadImageToS3 = useCallback(async (file: File): Promise<string> => {
    const prefix = `${orgId}/editor-images`;
    const presign = await triggerPresignUpload({ fileName: file.name, contentType: file.type, prefix });
    await uploadFileToS3(presign.url, presign.method, file);
    return presign.key;
  }, [orgId, triggerPresignUpload]);

  const handleGetDownloadUrl = useCallback(async (key: string): Promise<string> => {
    const presign = await triggerPresignDownload({ key });
    return presign.url;
  }, [triggerPresignDownload]);

  const hasContent = doc ? isContentDocument(doc) : false;
  const [isImageUploading, setIsImageUploading] = useState(false);

  // ── Load HTML from S3 (or legacy inline fallback) when dialog is open ──
  const {
    html: remoteHtml,
    isLoading: isHtmlLoading,
    mutate: mutateHtml,
  } = useRFPDocumentHtmlContent(
    open && doc ? doc.projectId : null,
    open && doc ? doc.opportunityId : null,
    open && doc ? doc.documentId : null,
    open && doc ? orgId : null,
  );

  // HTML content is managed outside react-hook-form
  const [htmlContent, setHtmlContent] = useState('');
  const htmlInitializedRef = useRef(false);

  const form = useForm<MetadataFormValues>({
    resolver: zodResolver(MetadataSchema),
    defaultValues: {
      name: '',
      description: '',
      documentType: 'OTHER',
      title: '',
      customerName: '',
      outlineSummary: '',
    },
  });

  // Populate metadata form when document changes
  useEffect(() => {
    if (!doc) return;
    const c = doc.content as Record<string, unknown> | null | undefined;
    form.reset({
      name: doc.name,
      description: doc.description ?? '',
      documentType: doc.documentType,
      title: (c?.title as string | undefined) ?? doc.title ?? '',
      customerName: (c?.customerName as string | undefined) ?? '',
      outlineSummary: (c?.outlineSummary as string | undefined) ?? '',
    });
    // Reset HTML init flag so it re-loads when a new doc opens
    htmlInitializedRef.current = false;
    setHtmlContent('');
  }, [doc, form]);

  // Populate HTML once loaded from S3.
  // The Lambda already resolved s3key: placeholders to presigned URLs server-side.
  useEffect(() => {
    if (isHtmlLoading || htmlInitializedRef.current || remoteHtml === undefined) return;
    htmlInitializedRef.current = true;
    setHtmlContent(remoteHtml);
  }, [remoteHtml, isHtmlLoading]);

  // Reset when dialog closes
  useEffect(() => {
    if (!open) {
      htmlInitializedRef.current = false;
      setHtmlContent('');
    }
  }, [open]);

  const handleHtmlChange = useCallback((html: string) => {
    setHtmlContent(html);
  }, []);

  const handleClose = useCallback(() => {
    if (!isMutating) onOpenChange(false);
  }, [isMutating, onOpenChange]);

  const onSubmit = useCallback(
    async (values: MetadataFormValues) => {
      if (!doc) return;

      try {
        const payload: Record<string, unknown> = {
          projectId: doc.projectId,
          opportunityId: doc.opportunityId,
          documentId: doc.documentId,
          name: values.name.trim(),
          description: values.description?.trim() || null,
          documentType: values.documentType,
        };

        if (hasContent) {
          const c = doc.content as Record<string, unknown> | null | undefined;
          const updatedContent: Record<string, unknown> = {
            ...(c ?? {}),
            title: values.title?.trim() || values.name.trim(),
            customerName: values.customerName?.trim() || undefined,
            outlineSummary: values.outlineSummary?.trim() || undefined,
            // Always strip presigned/blob URLs before saving
            content: stripPresignedUrlsFromHtml(htmlContent),
          };

          payload.content = updatedContent;
          payload.title = updatedContent.title as string;
        }

        await updateDocument(payload as Parameters<typeof updateDocument>[0]);
        // Revalidate SWR cache in background — keep editor content to avoid breaking images
        htmlInitializedRef.current = true;
        await mutateHtml();

        toast({
          title: 'Document updated',
          description: `"${values.name.trim()}" has been saved successfully.`,
        });

        onOpenChange(false);
        onSuccess?.();
      } catch (err) {
        toast({
          title: 'Update failed',
          description: err instanceof Error ? err.message : 'Could not update document.',
          variant: 'destructive',
        });
      }
    },
    [doc, hasContent, htmlContent, updateDocument, mutateHtml, toast, onOpenChange, onSuccess],
  );

  if (!doc) return null;

  const dialogClass = hasContent
    ? 'flex flex-col !w-[85vw] !max-w-none h-[92vh]'
    : 'flex flex-col sm:max-w-lg';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={dialogClass}>
        {/* ── Header ── */}
        <DialogHeader className="shrink-0">
          <div className="flex items-center gap-2">
            <DialogTitle>Edit Document</DialogTitle>
            <DocumentTypeBadge type={doc.documentType} />
          </div>
          <DialogDescription>
            {hasContent
              ? 'Edit document metadata on the Metadata tab and the full document content on the Content tab.'
              : 'Update the name, type, and description for this document.'}
          </DialogDescription>
        </DialogHeader>

        <Separator className="shrink-0" />

        {/* ── Body ── */}
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="flex flex-col flex-1 min-h-0 gap-0"
          >
            {hasContent ? (
              /* ── Content document: tabbed layout ── */
              <Tabs defaultValue="content" className="flex flex-col flex-1 min-h-0">
                <TabsList className="shrink-0 self-start mx-0 mb-2">
                  <TabsTrigger value="metadata">Metadata</TabsTrigger>
                  <TabsTrigger value="content">Content</TabsTrigger>
                </TabsList>

                {/* Metadata tab */}
                <TabsContent value="metadata" className="flex-1 overflow-y-auto space-y-4 pr-1">
                  <MetadataFields form={form} isMutating={isMutating} />
                </TabsContent>

                {/* Content tab — loads HTML from S3 via useRFPDocumentHtmlContent */}
                <TabsContent value="content" className="flex-1 min-h-0 flex flex-col">
                  {isHtmlLoading ? (
                    <div className="flex-1 flex flex-col gap-3 p-4">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-full w-full" />
                    </div>
                  ) : (
                    <RichTextEditor
                      value={htmlContent}
                      onChange={handleHtmlChange}
                      disabled={isMutating}
                      className="flex-1 min-h-0"
                      minHeight="calc(92vh - 220px)"
                      onUploadImageToS3={handleUploadImageToS3}
                      onGetDownloadUrl={handleGetDownloadUrl}
                      onUploadingChange={setIsImageUploading}
                    />
                  )}
                </TabsContent>
              </Tabs>
            ) : (
              /* ── Metadata-only document (uploaded file, no editable content) ── */
              <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
                <MetadataFields form={form} isMutating={isMutating} />
              </div>
            )}

            {/* ── Footer ── */}
            <Separator className="shrink-0 mt-2" />
            <DialogFooter className="shrink-0 pt-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isMutating}
              >
                <X className="h-4 w-4 mr-2" />
                Cancel
              </Button>
              <Button type="submit" disabled={isMutating || isHtmlLoading || isImageUploading} title={isImageUploading ? 'Please wait for image upload to complete' : undefined}>
                {isMutating ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save Changes
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

// ─── MetadataFields ───────────────────────────────────────────────────────────

interface MetadataFieldsProps {
  form: ReturnType<typeof useForm<MetadataFormValues>>;
  isMutating: boolean;
}

const MetadataFields = ({ form, isMutating }: MetadataFieldsProps) => (
  <>
    {/* Name */}
    <FormField
      control={form.control}
      name="name"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Document Name *</FormLabel>
          <FormControl>
            <Input {...field} disabled={isMutating} placeholder="e.g. Technical Proposal v2" />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />

    {/* Document Type */}
    <FormField
      control={form.control}
      name="documentType"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Document Type</FormLabel>
          <Select
            value={field.value}
            onValueChange={field.onChange}
            disabled={isMutating}
          >
            <FormControl>
              <SelectTrigger>
                <SelectValue placeholder="Select type…" />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {Object.entries(RFP_DOCUMENT_TYPES).map(([key, label]) => (
                <SelectItem key={key} value={key}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FormMessage />
        </FormItem>
      )}
    />

    {/* Description */}
    <FormField
      control={form.control}
      name="description"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Description</FormLabel>
          <FormControl>
            <Textarea
              {...field}
              rows={3}
              disabled={isMutating}
              placeholder="Optional short description of this document…"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  </>
);

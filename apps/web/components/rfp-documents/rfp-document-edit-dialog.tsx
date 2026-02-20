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
import { useToast } from '@/components/ui/use-toast';

import {
  type RFPDocumentItem,
  type RFPDocumentType,
  RFP_DOCUMENT_TYPES,
  useUpdateRFPDocument,
} from '@/lib/hooks/use-rfp-documents';
import { RichTextEditor } from './rich-text-editor';

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

const getDocumentHtml = (doc: RFPDocumentItem): string =>
  (doc.content as Record<string, unknown> | null | undefined)?.content as string ?? '';

const isContentDocument = (doc: RFPDocumentItem): boolean => doc.content != null;

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

  // HTML content is managed outside react-hook-form because RichTextEditor
  // is an uncontrolled-style component that emits HTML strings.
  const [htmlContent, setHtmlContent] = useState('');
  const htmlDirtyRef = useRef(false);

  const hasContent = doc ? isContentDocument(doc) : false;

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

  // Populate form when document changes
  useEffect(() => {
    if (!doc) return;

    const c = doc.content as Record<string, unknown> | null | undefined;

    form.reset({
      name: doc.name,
      description: doc.description ?? '',
      documentType: doc.documentType,
      title: (c?.title as string | undefined) ?? '',
      customerName: (c?.customerName as string | undefined) ?? '',
      outlineSummary: (c?.outlineSummary as string | undefined) ?? '',
    });

    setHtmlContent(getDocumentHtml(doc));
    htmlDirtyRef.current = false;
  }, [doc, form]);

  const handleHtmlChange = useCallback((html: string) => {
    setHtmlContent(html);
    htmlDirtyRef.current = true;
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

        if (hasContent && doc.content) {
          const baseContent = doc.content as Record<string, unknown>;
          const updatedContent: Record<string, unknown> = {
            ...baseContent,
            title: values.title?.trim() || values.name.trim(),
            customerName: values.customerName?.trim() || undefined,
            outlineSummary: values.outlineSummary?.trim() || undefined,
            content: htmlContent,
          };

          payload.content = updatedContent;
          payload.title = updatedContent.title as string;
        }

        await updateDocument(payload as Parameters<typeof updateDocument>[0]);

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
    [doc, hasContent, htmlContent, updateDocument, toast, onOpenChange, onSuccess],
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
                  <MetadataFields form={form} isMutating={isMutating} showContentFields />
                </TabsContent>

                {/* Content tab — always uses RichTextEditor */}
                <TabsContent value="content" className="flex-1 min-h-0 flex flex-col">
                  <RichTextEditor
                    value={htmlContent}
                    onChange={handleHtmlChange}
                    disabled={isMutating}
                    className="flex-1 min-h-0"
                    minHeight="calc(92vh - 220px)"
                  />
                </TabsContent>
              </Tabs>
            ) : (
              /* ── Metadata-only document (uploaded file, no editable content) ── */
              <div className="flex-1 overflow-y-auto space-y-4 py-2 pr-1">
                <MetadataFields form={form} isMutating={isMutating} showContentFields={false} />
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
              <Button type="submit" disabled={isMutating}>
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
  showContentFields: boolean;
}

const MetadataFields = ({ form, isMutating, showContentFields }: MetadataFieldsProps) => (
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

    {/* Content-specific fields */}
    {showContentFields && (
      <>
        <Separator />

        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
          Document Content Fields
        </p>

        {/* Proposal Title */}
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Document Title</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  disabled={isMutating}
                  placeholder="Title shown in the document header"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Customer Name */}
        <FormField
          control={form.control}
          name="customerName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Customer / Agency Name</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  disabled={isMutating}
                  placeholder="e.g. Department of Defense"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Executive Summary */}
        <FormField
          control={form.control}
          name="outlineSummary"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Executive Summary / Outline</FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  rows={4}
                  disabled={isMutating}
                  placeholder="High-level summary or outline for this document…"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </>
    )}
  </>
);

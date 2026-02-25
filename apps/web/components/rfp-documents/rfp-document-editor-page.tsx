'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Loader2,
  Save,
  Settings2,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';

import {
  type RFPDocumentItem,
  type RFPDocumentType,
  RFP_DOCUMENT_TYPES,
  useUpdateRFPDocument,
  useRFPDocumentHtmlContent,
  useRFPDocumentPolling,
} from '@/lib/hooks/use-rfp-documents';
import { RichTextEditor, stripPresignedUrlsFromHtml } from './rich-text-editor';
import {
  usePresignUpload,
  usePresignDownload,
  uploadFileToS3,
} from '@/lib/hooks/use-presign';

// ─── Metadata form schema ─────────────────────────────────────────────────────

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

interface RFPDocumentEditorPageProps {
  orgId: string;
  projectId: string;
  documentId: string;
  opportunityId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isContentDocument = (doc: RFPDocumentItem): boolean =>
  !!(doc.content || doc.htmlContentKey);

// ─── Loading skeleton ─────────────────────────────────────────────────────────

const EditorSkeleton = () => (
  <div className="flex flex-col h-screen">
    <div className="flex items-center gap-3 px-4 py-3 border-b">
      <Skeleton className="h-8 w-8 rounded" />
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-5 w-24 ml-auto" />
      <Skeleton className="h-8 w-24" />
    </div>
    <div className="flex-1 p-6">
      <Skeleton className="h-full w-full rounded-lg" />
    </div>
  </div>
);

// ─── Metadata sheet ───────────────────────────────────────────────────────────

interface MetadataSheetProps {
  form: ReturnType<typeof useForm<MetadataFormValues>>;
  isMutating: boolean;
  onSubmit: (values: MetadataFormValues) => void;
}

const MetadataSheet = ({ form, isMutating, onSubmit }: MetadataSheetProps) => (
  <Sheet>
    <SheetTrigger asChild>
      <Button variant="outline" size="sm">
        <Settings2 className="h-4 w-4 mr-2" />
        Document Settings
      </Button>
    </SheetTrigger>
    <SheetContent className="w-[420px] sm:w-[480px] overflow-y-auto">
      <SheetHeader>
        <SheetTitle>Document Settings</SheetTitle>
        <SheetDescription>
          Update metadata for this document. Changes are saved when you click Save.
        </SheetDescription>
      </SheetHeader>

      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="mt-6 space-y-5"
        >
          {/* Name */}
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Document Name *</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    disabled={isMutating}
                    placeholder="e.g. Technical Proposal v2"
                  />
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
                    placeholder="Optional short description…"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Separator />
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
            Content Fields
          </p>

          {/* Document Title */}
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

          {/* Outline Summary */}
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
                    placeholder="High-level summary or outline…"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" className="w-full" disabled={isMutating}>
            {isMutating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save Settings
              </>
            )}
          </Button>
        </form>
      </Form>
    </SheetContent>
  </Sheet>
);

// ─── Main component ───────────────────────────────────────────────────────────

export const RFPDocumentEditorPage = ({
  orgId,
  projectId,
  documentId,
  opportunityId,
}: RFPDocumentEditorPageProps) => {
  const router = useRouter();
  const { toast } = useToast();

  // Poll document metadata (stops once status !== GENERATING)
  const { document: doc, isLoading: isDocLoading } = useRFPDocumentPolling(
    projectId,
    opportunityId,
    documentId,
    orgId,
  );

  // Load HTML content from S3 (or fallback to inline)
  const {
    html: initialHtml,
    isLoading: isHtmlLoading,
    mutate: mutateHtml,
  } = useRFPDocumentHtmlContent(
    doc ? projectId : null,
    doc ? opportunityId : null,
    doc ? documentId : null,
    doc ? orgId : null,
  );

  const { trigger: updateDocument, isMutating } = useUpdateRFPDocument(orgId);

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

  // Local HTML state — editor is the source of truth
  const [htmlContent, setHtmlContent] = useState('');
  const htmlInitializedRef = useRef(false);
  // Track image upload state to disable Save button
  const [isImageUploading, setIsImageUploading] = useState(false);

  // Header / footer (colontitles) state
  const [headerText, setHeaderText] = useState('');
  const [footerText, setFooterText] = useState('');

  // Populate HTML once loaded.
  // The Lambda already resolved s3key: placeholders to presigned URLs server-side,
  // so we just set the HTML directly — no client-side resolution needed.
  useEffect(() => {
    if (isHtmlLoading || htmlInitializedRef.current || initialHtml === undefined) return;
    htmlInitializedRef.current = true;
    setHtmlContent(initialHtml);
  }, [initialHtml, isHtmlLoading]);

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

  // Populate metadata form when document loads
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
  }, [doc, form]);

  const handleHtmlChange = useCallback((html: string) => {
    setHtmlContent(html);
  }, []);

  // Save HTML content (and optionally metadata)
  const handleSaveContent = useCallback(async () => {
    if (!doc) return;
    try {
      const c = doc.content as Record<string, unknown> | null | undefined;
      // Always strip presigned/blob URLs before saving — backend stores clean HTML
      const cleanHtml = stripPresignedUrlsFromHtml(htmlContent);

      await updateDocument({
        projectId,
        opportunityId,
        documentId,
        content: {
          title: form.getValues('title') || doc.name,
          customerName: form.getValues('customerName') || undefined,
          outlineSummary: form.getValues('outlineSummary') || undefined,
          // Pass stripped HTML — backend will upload to S3
          content: cleanHtml,
        },
      } as Parameters<typeof updateDocument>[0]);

      // Revalidate the SWR cache in the background without clearing the editor content.
      // The editor already shows the correct content with resolved images.
      // We don't clear htmlContent here to avoid breaking the image display.
      htmlInitializedRef.current = true; // keep initialized so re-fetch doesn't overwrite
      await mutateHtml();

      toast({
        title: 'Document saved',
        description: 'HTML content has been saved to S3.',
      });
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Could not save document.',
        variant: 'destructive',
      });
    }
  }, [doc, projectId, opportunityId, documentId, htmlContent, form, updateDocument, mutateHtml, toast]);

  // Save metadata from the settings sheet
  const handleSaveMetadata = useCallback(
    async (values: MetadataFormValues) => {
      if (!doc) return;
      try {
        const c = doc.content as Record<string, unknown> | null | undefined;
        await updateDocument({
          projectId,
          opportunityId,
          documentId,
          name: values.name.trim(),
          description: values.description?.trim() || null,
          documentType: values.documentType as RFPDocumentType,
          content: {
            ...(c ?? {}),
            title: values.title?.trim() || values.name.trim(),
            customerName: values.customerName?.trim() || undefined,
            outlineSummary: values.outlineSummary?.trim() || undefined,
            // Don't re-send HTML here — only metadata update
          },
          title: values.title?.trim() || values.name.trim(),
        } as Parameters<typeof updateDocument>[0]);

        toast({
          title: 'Settings saved',
          description: `"${values.name.trim()}" settings updated.`,
        });
      } catch (err) {
        toast({
          title: 'Save failed',
          description: err instanceof Error ? err.message : 'Could not save settings.',
          variant: 'destructive',
        });
      }
    },
    [doc, projectId, opportunityId, documentId, updateDocument, toast],
  );

  const isLoading = isDocLoading || isHtmlLoading;
  const isGenerating = doc?.status === 'GENERATING';

  if (isLoading && !doc) {
    return <EditorSkeleton />;
  }

  if (!doc) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <FileText className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Document not found.</p>
        <Button variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Go Back
        </Button>
      </div>
    );
  }

  const backUrl = `/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}`;

  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* ── Top bar ── */}
      <header className="flex items-center gap-2 px-4 py-2.5 border-b bg-background shrink-0">
        {/* Breadcrumb */}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground hover:text-foreground px-2"
          asChild
        >
          <Link href={backUrl}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
        </Button>

        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />

        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium text-sm truncate max-w-xs" title={doc.name}>
            {doc.name}
          </span>
          <Badge variant="outline" className="text-xs shrink-0">
            {RFP_DOCUMENT_TYPES[doc.documentType as RFPDocumentType] ?? doc.documentType}
          </Badge>
          {isGenerating && (
            <Badge
              variant="outline"
              className="text-xs border-amber-500/30 text-amber-600 bg-amber-500/5 animate-pulse shrink-0"
            >
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Generating…
            </Badge>
          )}
        </div>

        {/* Actions */}
        <div className="ml-auto flex items-center gap-2">
          <MetadataSheet
            form={form}
            isMutating={isMutating}
            onSubmit={handleSaveMetadata}
          />
          <Button
            size="sm"
            onClick={handleSaveContent}
            disabled={isMutating || isGenerating || isHtmlLoading || isImageUploading}
            title={isImageUploading ? 'Please wait for image upload to complete' : undefined}
          >
            {isMutating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Save className="h-4 w-4 mr-2" />
                Save
              </>
            )}
          </Button>
        </div>
      </header>

      {/* ── Editor body ── */}
      <main className="flex-1 min-h-0 overflow-hidden">
        {isGenerating ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
            <Loader2 className="h-10 w-10 animate-spin text-indigo-500" />
            <p className="text-sm font-medium">Generating document content…</p>
            <p className="text-xs">This may take up to a minute. The editor will unlock when ready.</p>
          </div>
        ) : isHtmlLoading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Loading content…</p>
          </div>
        ) : (
          <RichTextEditor
            value={htmlContent}
            onChange={handleHtmlChange}
            disabled={isMutating}
            className="h-full rounded-none border-0"
            minHeight="100%"
            header={headerText}
            onHeaderChange={setHeaderText}
            footer={footerText}
            onFooterChange={setFooterText}
            onUploadImageToS3={handleUploadImageToS3}
            onGetDownloadUrl={handleGetDownloadUrl}
            onUploadingChange={setIsImageUploading}
          />
        )}
      </main>
    </div>
  );
};

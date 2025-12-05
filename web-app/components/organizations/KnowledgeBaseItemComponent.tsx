"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PlusCircle, FileText, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

import { useKnowledgeBase } from "@/lib/hooks/use-knowledgebase";
import {
  useDocumentsByKb,
  useCreateDocument,
  useIndexDocument, useStartDocumentPipeline,
} from '@/lib/hooks/use-document';
import { UploadFileToS3 } from "@/components/upload/UploadFileToS3";
import { useDownloadFromS3 } from "@/lib/hooks/use-file";

export default function KnowledgeBaseItemComponent() {
  const { orgId, kbId } = useParams<{ orgId: string; kbId: string }>();

  const {
    data: kb,
    isLoading: kbLoading,
    error: kbError,
  } = useKnowledgeBase(kbId, orgId);

  const {
    data: documents,
    isLoading: docsLoading,
    mutate: refreshDocuments,
  } = useDocumentsByKb(kbId);

  const { trigger: startPipeline, isMutating } = useStartDocumentPipeline();
  const createDocument = useCreateDocument();

  const [showUpload, setShowUpload] = useState(false);

  const {
    downloadFile,
    isDownloading,
    error: downloadError,
  } = useDownloadFromS3();

  const isLoading = kbLoading || docsLoading;

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto py-10 px-4 text-muted-foreground">
        Loading knowledge base...
      </div>
    );
  }

  if (kbError) {
    return (
      <div className="max-w-5xl mx-auto py-10 px-4 text-red-500">
        Error loading KB: {kbError.message}
      </div>
    );
  }

  const docs = documents ?? [];
  const totalDocs = docs.length;
  const readyDocs = docs.filter((d) => d.indexStatus === "ready").length;

  const statusVariant = (status: string) => {
    if (status === "ready") return "default" as const;
    if (status === "failed") return "destructive" as const;
    return "secondary" as const;
  };

  const statusLabel = (status: string) => {
    switch (status) {
      case "ready":
        return "Indexed";
      case "processing":
        return "Indexing…";
      case "pending":
        return "Pending";
      case "failed":
        return "Failed";
      default:
        return status;
    }
  };

  const handleUploadDocument: (result: {
    fileKey: string;
    fileId: string;
    sortKey: string;
    fileName: string;
  }) => void = async ({ fileKey, fileName }) => {
    try {
      // 1) Save metadata to Dynamo
      const resp = await createDocument.trigger({
        knowledgeBaseId: kbId,
        name: fileName,
        fileKey,
        textFileKey: `${fileKey}.txt`,
      });

      await startPipeline({
        documentId: resp.id,
      });

      // 2) Kick off indexing
/*      await indexDocument({
        knowledgeBaseId: kbId,
        documentId: resp.id,
      });*/
    } finally {
      setShowUpload(false);
      await refreshDocuments();
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8 py-10 px-4">
      {/* HEADER / SUMMARY */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Knowledge Base
            </p>
            <h1 className="text-2xl font-semibold leading-tight">
              {kb?.name}
            </h1>
            {kb?.description && (
              <p className="text-sm text-muted-foreground max-w-2xl">
                {kb.description}
              </p>
            )}
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                Documents:{" "}
                <span className="font-medium text-foreground">
                  {totalDocs}
                </span>
              </span>
              <span className="text-muted-foreground">
                Indexed:{" "}
                <span className="font-medium text-foreground">
                  {readyDocs}
                </span>
              </span>
            </div>

            <Button size="sm" onClick={() => setShowUpload(true)}>
              <PlusCircle className="h-4 w-4 mr-2" />
              Upload document
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* DOCUMENT LIST */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Documents</CardTitle>
        </CardHeader>

        <CardContent className="pt-0">
          {docs.length ? (
            <div className="border rounded-md divide-y bg-card">
              {docs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 hover:bg-muted/60 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                    </div>

                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{doc.name}</span>

                        <Badge
                          variant={statusVariant(doc.indexStatus)}
                          className="text-[10px] uppercase tracking-wide flex items-center gap-1"
                        >
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              doc.indexStatus === "ready"
                                ? "bg-emerald-500"
                                : doc.indexStatus === "failed"
                                  ? "bg-red-500"
                                  : "bg-amber-500"
                            }`}
                          />
                          {statusLabel(doc.indexStatus)}
                        </Badge>
                      </div>

                      <p className="text-xs text-muted-foreground">
                        Uploaded{" "}
                        {new Date(doc.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isDownloading}
                      onClick={() =>
                        downloadFile({
                          key: doc.fileKey,
                          fileName: doc.name,
                        })
                      }
                    >
                      <Download className="h-4 w-4 mr-1" />
                      {isDownloading ? "Downloading…" : "Download"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
              <FileText className="h-8 w-8 mb-2 text-muted-foreground/70" />
              <p className="mb-1">No documents yet.</p>
              <p className="mb-3 text-xs">
                Upload your first document to start indexing and Q&amp;A.
              </p>
              <Button size="sm" variant="outline" onClick={() => setShowUpload(true)}>
                <PlusCircle className="h-4 w-4 mr-2" />
                Upload document
              </Button>
            </div>
          )}

          {downloadError && (
            <p className="mt-3 text-xs text-red-500">
              Download error: {downloadError.message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* UPLOAD MODAL */}
      <Dialog open={showUpload} onOpenChange={setShowUpload}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload document</DialogTitle>
          </DialogHeader>

          <UploadFileToS3
            prefix={`org_${orgId}/kb_${kbId}`}
            buttonLabel="Choose file to upload"
            onUploaded={handleUploadDocument}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

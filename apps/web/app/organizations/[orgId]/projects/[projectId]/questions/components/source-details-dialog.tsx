"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { ExternalLink } from "lucide-react"
import { AnswerSource } from "@auto-rfp/core"
import { useDownloadDocument } from "@/lib/hooks/use-document"

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  search_knowledge_base: 'Knowledge Base',
  search_past_performance: 'Past Performance',
  get_content_library: 'Content Library',
  content_library_match: 'Content Library (Direct Match)',
  get_organization_context: 'Organization Profile',
  get_solicitation_text: 'Solicitation/RFP',
};

export const getToolDisplayName = (toolName?: string): string | undefined => {
  if (!toolName) return undefined;
  return TOOL_DISPLAY_NAMES[toolName] ?? toolName;
};

interface SourceDetailsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  source: AnswerSource | null;
}

export function SourceDetailsDialog({ isOpen, onClose, source }: SourceDetailsDialogProps) {
  const [isTextTabActive, setIsTextTabActive] = useState(true);
  const { trigger: downloadDocument, isMutating: isDownloading } = useDownloadDocument();

  const canViewDocument = source?.documentId && source?.kbId;

  const handleViewDocument = async () => {
    if (!source?.documentId || !source?.kbId) return;
    try {
      const result = await downloadDocument({ documentId: source.documentId, kbId: source.kbId });
      if (result?.url) {
        window.open(result.url, '_blank');
      }
    } catch (err) {
      console.error('Failed to get document URL:', err);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl">
        <div className="flex justify-between items-center mb-2">
          <DialogTitle className="text-xl font-semibold">Source Information</DialogTitle>
        </div>
        <div className="text-sm text-gray-500 mb-4">Details about this source document</div>

        {source && (
          <div>
            {/* Tab Navigation */}
            <div className="flex border-b mb-4">
              <button
                className={`px-4 py-2 font-medium ${isTextTabActive ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                onClick={() => setIsTextTabActive(true)}
              >
                Text Content
              </button>
              <button
                className={`px-4 py-2 font-medium ${!isTextTabActive ? 'border-b-2 border-blue-500 text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                onClick={() => setIsTextTabActive(false)}
              >
                Metadata
              </button>
            </div>

            {/* Text Content Tab */}
            {isTextTabActive ? (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-medium">Text:</h3>
                  <div className="text-sm ">
                    {source.fileName} {source.pageNumber ? `- Page ${source.pageNumber}` : ''}
                  </div>
                </div>

                {source.textContent ? (
                  <ScrollArea className="h-72 w-full border rounded-md">
                    <div className="whitespace-pre-wrap font-mono text-sm p-4">
                      {source.textContent}
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="h-72 border rounded-md p-3 flex items-center justify-center text-gray-500 bg-gray-50">
                    No text content available for this source
                  </div>
                )}
              </div>
            ) : (
              /* Metadata Tab */
              <div className="space-y-4">
                {source.toolName && (
                  <div className="flex flex-col space-y-1">
                    <span className="text-sm font-medium text-gray-500">Source Tool</span>
                    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {getToolDisplayName(source.toolName)}
                    </span>
                  </div>
                )}

                <div className="flex flex-col space-y-1">
                  <span className="text-sm font-medium text-gray-500">File Name</span>
                  <span className="font-medium">{source.fileName}</span>
                </div>

                {source.pageNumber && (
                  <div className="flex flex-col space-y-1">
                    <span className="text-sm font-medium text-gray-500">Page Number</span>
                    <span>{source.pageNumber}</span>
                  </div>
                )}

                {source.relevance !== null && source.relevance !== undefined && (
                  <div className="flex flex-col space-y-1">
                    <span className="text-sm font-medium text-gray-500">Relevance</span>
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                      <div
                        className="bg-blue-600 h-2.5 rounded-full"
                        style={{ width: `${Math.round(source.relevance * 100)}%` }}
                      ></div>
                    </div>
                    <span className="text-xs text-gray-500">{Math.round(source.relevance * 100)}% match</span>
                  </div>
                )}

                <div className="border-t pt-4">
                  {canViewDocument ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={handleViewDocument}
                      disabled={isDownloading}
                    >
                      <ExternalLink className="h-4 w-4" />
                      {isDownloading ? 'Opening...' : 'View Source Document'}
                    </Button>
                  ) : (
                    <p className="text-sm text-gray-500">
                      This source was used to generate the answer.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
} 
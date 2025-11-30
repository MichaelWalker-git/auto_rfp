"use client"

import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { FileText, Upload, Plus, ExternalLink } from "lucide-react"

interface NoQuestionsAvailableProps {
  projectId: string;
  onUploadClick?: () => void;
}

export function NoQuestionsAvailable({ projectId, onUploadClick }: NoQuestionsAvailableProps) {
  const router = useRouter();

  const handleUploadClick = () => {
    if (onUploadClick) {
      onUploadClick();
    } else {
      // Fallback to old behavior if no callback provided
      router.push(`/upload?projectId=${projectId}`);
    }
  };

  const handleAddManuallyClick = () => {
    router.push(`/questions/create?projectId=${projectId}`);
  };

  const sampleFileUrl = "https://qluspotebpidccpfbdho.supabase.co/storage/v1/object/public/sample-files//RFP%20-%20Launch%20Services%20for%20Medium-Lift%20Payloads.pdf";

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] py-12">
      <div className="text-center max-w-lg px-4">
        <div className="mb-6">
          <FileText className="mx-auto h-16 w-16 text-gray-400 mb-4" />
        </div>
        <h3 className="text-2xl font-semibold text-gray-900 mb-3">No Questions Available</h3>
        <p className="text-gray-600 mb-4 leading-relaxed">
          To get started, upload documents for AI to extract questions automatically, or add questions manually.
        </p>
        
        {/* Sample file suggestion */}
        <div className="mb-8">
          <p className="text-sm text-gray-500 mb-2">
            Sample file below, you can download it and upload it to the project.
          </p>
          <a 
            href={sampleFileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 hover:underline transition-colors"
          >
            <FileText className="h-3.5 w-3.5" />
            RFP - Launch Services for Medium-Lift Payloads
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Button onClick={handleUploadClick} className="gap-2 px-6 py-2.5">
            <Upload className="h-4 w-4" />
            Upload Documents
          </Button>
          <Button variant="outline" onClick={handleAddManuallyClick} className="gap-2 px-6 py-2.5">
            <Plus className="h-4 w-4" />
            Add Manually
          </Button>
        </div>
      </div>
    </div>
  );
} 
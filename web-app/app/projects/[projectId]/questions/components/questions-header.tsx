"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { Search, Save, Download } from "lucide-react"

interface QuestionsHeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSaveAll: () => void;
  onExport: () => void;
  unsavedCount: number;
  isSaving: boolean;
}

export function QuestionsHeader({
  searchQuery,
  onSearchChange,
  onSaveAll,
  onExport,
  unsavedCount,
  isSaving
}: QuestionsHeaderProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">RFP Questions</h2>
        <div className="flex items-center gap-2">

          
          <Button 
            variant="outline" 
            size="sm" 
            className="gap-1" 
            onClick={onSaveAll}
            disabled={unsavedCount === 0 || isSaving}
          >
            {isSaving ? (
              <>
                <Spinner className="h-4 w-4" />
                Saving...
              </>
            ) : (
              <>
                <Save className="h-4 w-4" />
                Save All
              </>
            )}
          </Button>
          
          <Button variant="outline" size="sm" className="gap-1" onClick={onExport}>
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {unsavedCount > 0 && (
        <div className="text-sm text-amber-600 flex items-center justify-end">
          <span>{unsavedCount} question{unsavedCount > 1 ? 's' : ''} with unsaved changes</span>
        </div>
      )}
    </div>
  );
} 
"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { AlertCircle, Save, Sparkles, Brain } from "lucide-react"
import { Spinner } from "@/components/ui/spinner"
import { AnswerDisplay } from "@/components/ui/answer-display"
import { AnswerSource } from "@/types/api"

interface AnswerData {
  text: string;
  sources?: AnswerSource[];
}

interface QuestionEditorProps {
  question: any;
  section: any;
  answer: AnswerData | undefined;
  selectedIndexes: Set<string>;
  isUnsaved: boolean;
  isSaving: boolean;
  isGenerating: boolean;
  useMultiStep: boolean;
  onAnswerChange: (value: string) => void;
  onSave: () => void;
  onGenerateAnswer: () => void;
  onSourceClick: (source: AnswerSource) => void;
  onMultiStepToggle: (enabled: boolean) => void;
}

export function QuestionEditor({
  question,
  section,
  answer,
  selectedIndexes,
  isUnsaved,
  isSaving,
  isGenerating,
  useMultiStep,
  onAnswerChange,
  onSave,
  onGenerateAnswer,
  onSourceClick,
  onMultiStepToggle
}: QuestionEditorProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>{section.title}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {question.question}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isUnsaved && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700">
                Unsaved
              </Badge>
            )}
            <Badge variant="outline" className={answer?.text ? "bg-green-50 text-green-700" : "bg-yellow-50 text-yellow-700"}>
              {answer?.text ? "Answered" : "Needs Answer"}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Index warning */}
        {selectedIndexes.size === 0 && (
          <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md text-sm">
            <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <span className="text-amber-700">
              No project indexes selected - AI will use default responses
            </span>
          </div>
        )}

        <Textarea
          placeholder="Enter your answer here..."
          className="min-h-[200px]"
          value={answer?.text || ""}
          onChange={(e) => onAnswerChange(e.target.value)}
        />
        
        {/* Show markdown preview if there's content */}
        {answer?.text && (
          <div className="mt-4">
            <h3 className="text-sm font-medium mb-2">Preview:</h3>
            <AnswerDisplay content={answer.text} />
          </div>
        )}
        
        {/* Display sources if available */}
        {answer?.sources && answer.sources.length > 0 && (
          <div className="mt-2 text-sm">
            <div className="font-medium text-gray-700">Sources:</div>
            <div className="flex flex-wrap gap-2 mt-1">
              {answer.sources.map((source) => (
                <span 
                  key={source.id} 
                  className="inline-block px-2 py-1 bg-slate-100 border border-slate-200 rounded text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer" 
                  title={`${source.fileName}${source.pageNumber ? ` - Page ${source.pageNumber}` : ''}`}
                  onClick={() => onSourceClick(source)}
                >
                  {source.id}
                </span>
              ))}
            </div>
          </div>
        )}
        
        {/* Action area */}
        <div className="flex items-center justify-between pt-4 border-t">
          <div className="flex items-center gap-3">
            {/* AI Generation Section */}
            <div className="flex items-center gap-2">
              <Button
                variant={useMultiStep ? "default" : "outline"}
                size="sm"
                className="gap-2"
                onClick={onGenerateAnswer}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    Generating...
                  </>
                ) : (
                  <>
                    {useMultiStep ? <Brain className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                    {useMultiStep ? 'Reasoning Mode' : 'Generate'}
                  </>
                )}
              </Button>
              
              {/* Compact multi-step toggle */}
              <div className="flex items-center gap-1.5" title="Enable step-by-step reasoning">
                <Brain className="h-4 w-4 text-muted-foreground" />
                <Switch 
                  checked={useMultiStep}
                  onCheckedChange={onMultiStepToggle}
                />
              </div>
            </div>

            {/* Index count badge */}
            {selectedIndexes.size > 0 && (
              <Badge variant="secondary" className="text-xs">
                {selectedIndexes.size} project {selectedIndexes.size === 1 ? 'index' : 'indexes'}
              </Badge>
            )}
          </div>

          {/* Save Actions */}
          <div className="flex items-center gap-2">
            {isUnsaved && (
              <Button 
                variant="outline" 
                size="sm"
                onClick={onSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <>
                    <Spinner className="h-4 w-4 mr-1" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-1" />
                    Save
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
} 
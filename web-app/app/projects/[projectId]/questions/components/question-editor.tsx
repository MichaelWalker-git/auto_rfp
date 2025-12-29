'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Save, Sparkles, Trash2 } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { AnswerDisplay } from '@/components/ui/answer-display';
import { AnswerSource } from '@/types/api';
import PermissionWrapper from '@/components/permission-wrapper';

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
  onAnswerChange: (value: string) => void;
  onSave: () => void;
  onGenerateAnswer: () => void;
  onSourceClick: (source: AnswerSource) => void;
  onRemoveQuestion: () => void;
  isRemoving?: boolean;
}

export function QuestionEditor({
                                 question,
                                 section,
                                 answer,
                                 selectedIndexes,
                                 isUnsaved,
                                 isSaving,
                                 isGenerating,
                                 onAnswerChange,
                                 onSave,
                                 onGenerateAnswer,
                                 onSourceClick,
                                 onRemoveQuestion,
                                 isRemoving = false,
                               }: QuestionEditorProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>{section.title}</CardTitle>
            <p className="text-sm text-muted-foreground">{question.question}</p>
          </div>

          <div className="flex items-center gap-2">
            {isUnsaved && (
              <Badge variant="outline" className="bg-amber-50 text-amber-700">
                Unsaved
              </Badge>
            )}
            <Badge
              variant="outline"
              className={answer?.text ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'}
            >
              {answer?.text ? 'Answered' : 'Needs Answer'}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <Textarea
          placeholder="Enter your answer here..."
          className="min-h-[200px]"
          value={answer?.text || ''}
          onChange={(e) => onAnswerChange(e.target.value)}
        />

        {answer?.text && (
          <div className="mt-4">
            <h3 className="text-sm font-medium mb-2">Preview:</h3>
            <AnswerDisplay content={answer.text}/>
          </div>
        )}

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
          <PermissionWrapper requiredPermission={'answer:generate'}>
            <div className="flex items-center gap-3">
              <Button
                variant={'outline'}
                size="sm"
                className="gap-2"
                onClick={onGenerateAnswer}
                disabled={isGenerating}
              >
                {isGenerating ? (
                  <>
                    <Spinner className="h-4 w-4"/>
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4"/>
                    Generate
                  </>
                )}
              </Button>

              {selectedIndexes.size > 0 && (
                <Badge variant="secondary" className="text-xs">
                  {selectedIndexes.size} project {selectedIndexes.size === 1 ? 'index' : 'indexes'}
                </Badge>
              )}
            </div>
          </PermissionWrapper>

          <div className="flex items-center gap-2">
            <PermissionWrapper requiredPermission={'question:delete'}>
              <Button
                variant="destructive"
                size="sm"
                onClick={onRemoveQuestion}
                disabled={isSaving || isGenerating || isRemoving}
                title="Remove this question (and its answer if exists)"
              >
                {isRemoving ? (
                  <>
                    <Spinner className="h-4 w-4 mr-1"/>
                    Removing...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-1"/>
                    Remove
                  </>
                )}
              </Button>
            </PermissionWrapper>
            <PermissionWrapper requiredPermission={'question:edit'}>
              {isUnsaved && (
                <Button variant="outline" size="sm" onClick={onSave} disabled={isSaving || isRemoving}>
                  {isSaving ? (
                    <>
                      <Spinner className="h-4 w-4 mr-1"/>
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-1"/>
                      Save
                    </>
                  )}
                </Button>
              )}
            </PermissionWrapper>

          </div>
        </div>
      </CardContent>
    </Card>
  );
}
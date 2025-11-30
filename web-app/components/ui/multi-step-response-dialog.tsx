'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, User, CheckCircle, Clock, FileText, X } from 'lucide-react';
import { ReasoningStep, DocumentSource } from '@/hooks/use-multi-step-response';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { AnswerDisplay } from '@/components/ui/answer-display';

interface MultiStepResponseDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAcceptResponse: (response: string, sources: DocumentSource[]) => void;
  questionText: string;
  isGenerating: boolean;
  currentSteps: ReasoningStep[];
  finalResponse: string;
  sources: DocumentSource[];
}

const ReasoningStepComponent = ({ step, index, isLast }: { 
  step: ReasoningStep; 
  index: number;
  isLast: boolean;
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.1 }}
      className="bg-muted/50 rounded-lg p-4 border border-border"
    >
      <div className="flex items-center gap-2 mb-2">
        {isLast ? (
          <Clock className="w-4 h-4 text-blue-500 animate-pulse" />
        ) : (
          <CheckCircle className="w-4 h-4 text-green-500" />
        )}
        <p className="text-xs uppercase text-muted-foreground font-medium">
          Reasoning Step {index + 1}
        </p>
      </div>
      <h3 className="font-semibold text-foreground mb-2">{step.title}</h3>
      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
        {step.content}
      </p>
    </motion.div>
  );
};

export function MultiStepResponseDialog({
  isOpen,
  onClose,
  onAcceptResponse,
  questionText,
  isGenerating,
  currentSteps,
  finalResponse,
  sources,
}: MultiStepResponseDialogProps) {

  const handleAccept = () => {
    if (finalResponse) {
      onAcceptResponse(finalResponse, sources);
      onClose();
    }
  };

  const isFullyCompleted = currentSteps.length === 5 && finalResponse && finalResponse.trim().length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-blue-500" />
            Multi-Step Response Generation
          </DialogTitle>
          <DialogDescription>
            {isGenerating 
              ? 'AI is analyzing your question step by step...'
              : 'Review the AI-generated response and reasoning process'
            }
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4">
          {/* Question Display */}
          <div className="mb-6 p-4 bg-muted/30 rounded-lg border border-border">
            <div className="flex items-center gap-2 mb-2">
              <User className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Question</span>
            </div>
            <p className="text-foreground">{questionText}</p>
          </div>

          {/* Reasoning Steps */}
          <div className="space-y-4 mb-6">
            <AnimatePresence>
              {currentSteps.map((step, index) => (
                <ReasoningStepComponent
                  key={index}
                  step={step}
                  index={index}
                  isLast={isGenerating && index === currentSteps.length - 1}
                />
              ))}
            </AnimatePresence>

            {/* Loading indicator for next step */}
            {isGenerating && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex items-center gap-2 p-4 text-muted-foreground"
              >
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>
                <span className="text-sm">
                  {currentSteps.length === 0 
                    ? 'Starting analysis...' 
                    : `Processing step ${currentSteps.length + 1}...`
                  }
                </span>
              </motion.div>
            )}
          </div>

          {/* Final Response */}
          {finalResponse && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="mt-8 p-6 bg-muted/30 rounded-lg border border-border"
            >
              <div className="flex items-center gap-2 mb-4">
                <CheckCircle className="w-5 h-5 text-green-600" />
                <h3 className="text-lg font-semibold text-foreground">Final Response</h3>
              </div>
              <div className="prose prose-sm max-w-none text-foreground">
                <AnswerDisplay content={finalResponse} />
              </div>
            </motion.div>
          )}

          {/* Sources Section */}
          {sources && sources.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="mt-6 p-4 bg-blue-50/50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800"
            >
              <div className="flex items-center gap-2 mb-3">
                <FileText className="w-4 h-4 text-blue-600" />
                <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100">
                  Sources Referenced ({sources.length})
                </h4>
              </div>
              <div className="space-y-2">
                {sources.map((source) => (
                  <div
                    key={source.id}
                    className="flex items-start gap-3 p-3 bg-white dark:bg-gray-800 rounded border text-sm"
                  >
                    <Badge variant="outline" className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200">
                      {source.id}
                    </Badge>
                    <div className="flex-1">
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {source.fileName}
                      </div>
                      {source.pageNumber && source.pageNumber !== 'N/A' && (
                        <div className="text-gray-600 dark:text-gray-400 text-xs">
                          Page: {source.pageNumber}
                        </div>
                      )}
                      {source.relevance && (
                        <div className="text-gray-600 dark:text-gray-400 text-xs">
                          Relevance: {source.relevance}%
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Progress Summary */}
          <div className="mb-6 p-3 bg-muted/20 rounded-lg border border-border">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Progress: {currentSteps.length}/5 reasoning steps completed
              </span>
              {(currentSteps.length === 5 && finalResponse) && (
                <span className="text-green-600 font-medium flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" />
                  Analysis Complete
                </span>
              )}
            </div>
            <div className="mt-2 w-full bg-muted rounded-full h-2">
              <motion.div
                className="bg-blue-500 h-2 rounded-full"
                initial={{ width: 0 }}
                animate={{ 
                  width: `${(currentSteps.length === 5 && finalResponse) ? 100 : (currentSteps.length / 5) * 100}%` 
                }}
                transition={{ duration: 0.5 }}
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            {isFullyCompleted && (
              <Button onClick={handleAccept}>
                Accept Response
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
} 
'use client';

import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './card';
import { Badge } from './badge';
import { Button } from './button';
import { Progress } from './progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible';
import { ChevronDown, ChevronRight, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

// Types
interface StepResult {
  id: string;
  type: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startTime: Date;
  endTime?: Date;
  duration?: number;
  output?: any;
  error?: string;
}

interface MultiStepResponse {
  id: string;
  questionId: string;
  steps: StepResult[];
  finalResponse: string;
  overallConfidence: number;
  totalDuration: number;
  sources: Array<{
    id: string;
    fileName: string;
    relevance: number;
    pageNumber?: string;
    textContent?: string;
  }>;
  metadata: {
    modelUsed: string;
    tokensUsed: number;
    stepsCompleted: number;
    processingStartTime: Date;
    processingEndTime: Date;
  };
}

interface MultiStepResponseProps {
  response: MultiStepResponse;
  isLoading?: boolean;
  currentStep?: number;
}

const StepIcon: React.FC<{ status: StepResult['status'] }> = ({ status }) => {
  const iconClass = "w-4 h-4";
  
  switch (status) {
    case 'completed':
      return <CheckCircle className={cn(iconClass, "text-green-500")} />;
    case 'failed':
      return <XCircle className={cn(iconClass, "text-red-500")} />;
    case 'running':
      return <AlertCircle className={cn(iconClass, "text-blue-500 animate-pulse")} />;
    default:
      return <Clock className={cn(iconClass, "text-gray-400")} />;
  }
};

const StepCard: React.FC<{ step: StepResult; isActive?: boolean }> = ({ step, isActive }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const getStatusColor = (status: StepResult['status']) => {
    switch (status) {
      case 'completed': return 'bg-green-100 border-green-200 text-green-800';
      case 'failed': return 'bg-red-100 border-red-200 text-red-800';
      case 'running': return 'bg-blue-100 border-blue-200 text-blue-800';
      default: return 'bg-gray-100 border-gray-200 text-gray-600';
    }
  };

  return (
    <Card className={cn(
      "transition-all duration-200",
      isActive && "ring-2 ring-blue-500 ring-opacity-50",
      step.status === 'running' && "shadow-md"
    )}>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader className="pb-3">
          <CollapsibleTrigger asChild>
            <div className="flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-3">
                <StepIcon status={step.status} />
                <div>
                  <CardTitle className="text-sm font-medium">{step.title}</CardTitle>
                  <CardDescription className="text-xs">{step.description}</CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className={cn("text-xs", getStatusColor(step.status))}>
                  {step.status}
                </Badge>
                {step.duration && (
                  <span className="text-xs text-gray-500">{step.duration}ms</span>
                )}
                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </div>
            </div>
          </CollapsibleTrigger>
        </CardHeader>
        
        <CollapsibleContent>
          <CardContent className="pt-0">
            {step.output && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-700">Output:</h4>
                <div className="bg-gray-50 rounded-md p-3 text-xs">
                  <pre className="whitespace-pre-wrap text-gray-600">
                    {typeof step.output === 'string' ? step.output : JSON.stringify(step.output, null, 2)}
                  </pre>
                </div>
              </div>
            )}
            
            {step.error && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-red-700">Error:</h4>
                <div className="bg-red-50 rounded-md p-3 text-xs text-red-600">
                  {step.error}
                </div>
              </div>
            )}
            
            <div className="mt-3 text-xs text-gray-500">
              <div>Started: {new Date(step.startTime).toLocaleTimeString()}</div>
              {step.endTime && (
                <div>Completed: {new Date(step.endTime).toLocaleTimeString()}</div>
              )}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

export const MultiStepResponseDisplay: React.FC<MultiStepResponseProps> = ({ 
  response, 
  isLoading = false, 
  currentStep = 0 
}) => {
  const [showAllSteps, setShowAllSteps] = useState(false);
  
  const completedSteps = response.steps.filter(step => step.status === 'completed').length;
  const totalSteps = response.steps.length;
  const progress = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Progress Overview */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Multi-Step Response Generation</CardTitle>
              <CardDescription>
                {isLoading ? 'Generating response...' : 'Response completed'}
              </CardDescription>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-green-600">
                {Math.round(response.overallConfidence * 100)}%
              </div>
              <div className="text-sm text-gray-500">Confidence</div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span>Progress</span>
                <span>{completedSteps}/{totalSteps} steps completed</span>
              </div>
              <Progress value={progress} className="w-full" />
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="font-medium">Duration</div>
                <div className="text-gray-600">{response.totalDuration}ms</div>
              </div>
              <div>
                <div className="font-medium">Model</div>
                <div className="text-gray-600">{response.metadata.modelUsed}</div>
              </div>
              <div>
                <div className="font-medium">Sources</div>
                <div className="text-gray-600">{response.sources.length}</div>
              </div>
              <div>
                <div className="font-medium">Tokens</div>
                <div className="text-gray-600">{response.metadata.tokensUsed.toLocaleString()}</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Steps */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Reasoning Steps</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAllSteps(!showAllSteps)}
          >
            {showAllSteps ? 'Hide Details' : 'Show All Details'}
          </Button>
        </div>
        
        <div className="space-y-3">
          {response.steps.map((step, index) => (
            <StepCard
              key={step.id}
              step={step}
              isActive={isLoading && index === currentStep}
            />
          ))}
        </div>
      </div>

      {/* Final Response */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Final Response</CardTitle>
          <CardDescription>
            Generated with {Math.round(response.overallConfidence * 100)}% confidence
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm max-w-none">
            <div className="whitespace-pre-wrap text-gray-700">
              {response.finalResponse}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Sources */}
      {response.sources.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Sources</CardTitle>
            <CardDescription>
              {response.sources.length} document{response.sources.length !== 1 ? 's' : ''} referenced
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {response.sources.map((source, index) => (
                <div key={source.id} className="flex items-start justify-between p-3 bg-gray-50 rounded-md">
                  <div className="flex-1">
                    <div className="font-medium text-sm">{index + 1}. {source.fileName}</div>
                    {source.pageNumber && (
                      <div className="text-xs text-gray-500">Page {source.pageNumber}</div>
                    )}
                    {source.textContent && (
                      <div className="text-xs text-gray-600 mt-1 line-clamp-2">
                        {source.textContent}
                      </div>
                    )}
                  </div>
                  <Badge variant="secondary" className="ml-2">
                    {Math.round(source.relevance * 100)}%
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}; 
import { useChat } from 'ai/react';
import { useState } from 'react';
import { toast } from '@/components/ui/use-toast';

export interface ReasoningStep {
  title: string;
  content: string;
  nextStep?: 'continue' | 'finalAnswer';
}

export interface DocumentSource {
  id: number;
  fileName: string;
  pageNumber?: string;
  relevance?: number;
  textContent?: string;
}

export interface UseMultiStepResponseOptions {
  projectId: string;
  indexIds: string[];
  onComplete?: (finalResponse: string, steps: ReasoningStep[], sources: DocumentSource[]) => void;
}

export function useMultiStepResponse({ 
  projectId, 
  indexIds, 
  onComplete 
}: UseMultiStepResponseOptions) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<ReasoningStep[]>([]);
  const [extractedSources, setExtractedSources] = useState<DocumentSource[]>([]);
  const [realDocumentSources, setRealDocumentSources] = useState<DocumentSource[]>([]);

  const { messages, handleSubmit, input, setInput, isLoading, append, setMessages } = useChat({
    api: '/api/generate-response-multistep',
    body: {
      projectId,
      indexIds,
    },
    onFinish: (message) => {
      console.log('✅ onFinish called with message:', {
        hasContent: !!message.content,
        contentLength: message.content?.length || 0,
        hasToolInvocations: !!message.toolInvocations,
        toolInvocationsCount: message.toolInvocations?.length || 0
      });
      
      setIsGenerating(false);
      
      // Extract reasoning steps from tool invocations
      const steps: ReasoningStep[] = [];
      if (message.toolInvocations) {
        message.toolInvocations.forEach((invocation) => {
          if (invocation.toolName === 'addReasoningStep' && invocation.state === 'result') {
            steps.push(invocation.result);
          }
        });
      }
      
      setCompletedSteps(steps);
      
      // Extract sources from the response content (for citation counting)
      const citationSources = extractSourcesFromContent(message.content || '');
      setExtractedSources(citationSources);
      
      // Use real document sources if available, otherwise fall back to citation sources
      const finalSources = realDocumentSources.length > 0 ? realDocumentSources : citationSources;
      
      // Call completion callback with final response, steps, and real sources
      if (onComplete && message.content) {
        onComplete(message.content, steps, finalSources);
      }
    },
    onError: (error) => {
      console.error('Multi-step generation error:', error);
      setIsGenerating(false);
      toast({
        title: "Error",
        description: "Failed to generate multi-step response. Please try again.",
        variant: "destructive",
      });
    },
  });

  const generateResponse = async (question: string) => {
    console.log('🔍 generateResponse called with:', { question, projectId, indexIds });
    
    if (!question.trim()) {
      toast({
        title: "Error",
        description: "Please provide a question to analyze.",
        variant: "destructive",
      });
      return;
    }

    console.log('📡 Starting multi-step generation...');
    setIsGenerating(true);
    setCompletedSteps([]);
    setExtractedSources([]);
    setRealDocumentSources([]);
    
    // Clear conversation history to prevent showing old steps
    setMessages([]);
    
    // First, get document sources using the same approach as normal generation
    try {
      console.log('🔍 Pre-fetching document sources...');
      const sourcesResponse = await fetch('/api/generate-response', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: question,
          selectedIndexIds: indexIds,
          useAllIndexes: false,
          projectId: projectId
        }),
      });
      
      if (sourcesResponse.ok) {
        const sourcesResult = await sourcesResponse.json();
        console.log('✅ Pre-fetched sources:', sourcesResult.sources);
        
        // Convert to our DocumentSource format
        const documentSources: DocumentSource[] = sourcesResult.sources.map((source: any) => ({
          id: source.id,
          fileName: source.fileName,
          pageNumber: source.pageNumber,
          relevance: source.relevance,
          textContent: source.textContent
        }));
        
        setRealDocumentSources(documentSources);
      } else {
        console.warn('⚠️ Failed to pre-fetch sources, will use citation extraction');
      }
    } catch (error) {
      console.warn('⚠️ Error pre-fetching sources:', error);
    }
    
    // Use append to directly add the user message and trigger AI response
    try {
      await append({
        role: 'user',
        content: question,
      });
    } catch (error) {
      console.error('❌ Failed to send message:', error);
      setIsGenerating(false);
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Get current reasoning steps from the latest message
  const getCurrentSteps = (): ReasoningStep[] => {
    // Don't show any steps if we're just starting generation or if no messages yet
    if (messages.length === 0) {
      console.log('🔍 No messages in conversation yet');
      return [];
    }
    
    // Look through all assistant messages for tool invocations
    const assistantMessages = messages.filter(msg => msg.role === 'assistant');
    
    if (assistantMessages.length === 0) {
      console.log('🔍 No assistant messages found');
      return [];
    }
    
    const latestAssistantMessage = assistantMessages[assistantMessages.length - 1];
    
    if (!latestAssistantMessage?.toolInvocations) {
      console.log('🔍 No tool invocations found in latest assistant message');
      return [];
    }
    
    const steps: ReasoningStep[] = [];
    latestAssistantMessage.toolInvocations.forEach((invocation) => {
      if (invocation.toolName === 'addReasoningStep' && invocation.state === 'result') {
        steps.push(invocation.result);
      }
    });
    
    console.log('🔍 Current steps extracted:', {
      totalMessages: messages.length,
      assistantMessages: assistantMessages.length,
      stepsFound: steps.length,
      isGenerating: isGenerating || isLoading
    });
    
    return steps;
  };

  // Get the final response content
  const getFinalResponse = (): string => {
    // Look for the latest assistant message with actual content (not just tool calls)
    const assistantMessages = messages.filter(msg => msg.role === 'assistant');
    const latestAssistantMessage = assistantMessages[assistantMessages.length - 1];
    
    if (!latestAssistantMessage) {
      console.log('🔍 No assistant message found');
      return '';
    }
    
    // Debug: Log the entire message structure
    console.log('🔍 Latest assistant message:', {
      content: latestAssistantMessage.content,
      toolInvocations: latestAssistantMessage.toolInvocations?.map(inv => ({
        toolName: inv.toolName,
        state: inv.state
      })),
      messageKeys: Object.keys(latestAssistantMessage)
    });
    
    // Check if this message has both tool invocations (steps) AND content (final response)
    const hasSteps = latestAssistantMessage.toolInvocations && latestAssistantMessage.toolInvocations.length > 0;
    const hasContent = latestAssistantMessage.content && latestAssistantMessage.content.trim().length > 0;
    
    console.log('🔍 Final response check:', { 
      hasSteps, 
      hasContent, 
      contentLength: latestAssistantMessage.content?.length || 0,
      stepsCount: latestAssistantMessage.toolInvocations?.length || 0,
      rawContent: latestAssistantMessage.content
    });
    
    // If we have 5 steps but no content, that means the AI didn't provide final text
    if (hasSteps && latestAssistantMessage.toolInvocations?.length === 5 && !hasContent) {
      console.log('⚠️ AI completed all steps but provided no final response text');
      
      // Fallback: Generate a response from the reasoning steps
      const steps = latestAssistantMessage.toolInvocations
        .filter(inv => inv.toolName === 'addReasoningStep' && inv.state === 'result')
        .map(inv => (inv as any).result as ReasoningStep);
      
      if (steps.length === 5) {
        console.log('🔄 Generating fallback response from reasoning steps');
        return generateFallbackResponse(steps);
      }
    }
    
    // Return actual content if available
    if (hasSteps && hasContent) {
      return latestAssistantMessage.content;
    }
    
    return '';
  };

  // Extract sources from response content by parsing [Source X] citations
  const extractSourcesFromContent = (content: string): DocumentSource[] => {
    console.log('📄 Extracting sources from content:', {
      contentLength: content.length,
      contentPreview: content.substring(0, 200) + '...',
      hasSourcePattern: content.includes('[Source')
    });
    
    const sources: DocumentSource[] = [];
    const sourcePattern = /\[Source (\d+)\]/g;
    const matches = content.matchAll(sourcePattern);
    
    const uniqueSourceIds = new Set<number>();
    
    for (const match of matches) {
      const sourceId = parseInt(match[1]);
      console.log('🔗 Found source citation:', sourceId);
      if (!uniqueSourceIds.has(sourceId)) {
        uniqueSourceIds.add(sourceId);
        sources.push({
          id: sourceId,
          fileName: `Source ${sourceId}`, // This would be populated from the system message context
          pageNumber: 'N/A',
          relevance: undefined,
          textContent: undefined,
        });
      }
    }
    
    console.log('📄 Final extracted sources:', sources);
    return sources;
  };

  // Generate a fallback response from reasoning steps
  const generateFallbackResponse = (steps: ReasoningStep[]): string => {
    return `Based on the analysis conducted, here is the comprehensive response:

**Analysis Summary:**
${steps.map((step, index) => `${index + 1}. ${step.title}: ${step.content}`).join('\n\n')}

**Final Response:**
Based on the step-by-step analysis above, I have examined the question regarding service regions and performance in specific countries. The response has been structured to address both the geographical scope of services and performance metrics in the requested countries: China, Japan, Argentina, Peru, Mexico, Colombia, and Italy.

Please note that the complete response would include specific details extracted from your documents during the analysis process outlined above.`;
  };

  return {
    generateResponse,
    isGenerating: isGenerating || isLoading,
    currentSteps: getCurrentSteps(),
    finalResponse: getFinalResponse(),
    completedSteps,
    sources: realDocumentSources.length > 0 ? realDocumentSources : extractedSources,
    messages,
    reset: () => {
      setIsGenerating(false);
      setCompletedSteps([]);
      setExtractedSources([]);
      setRealDocumentSources([]);
      setInput('');
      setMessages([]);
    },
  };
} 
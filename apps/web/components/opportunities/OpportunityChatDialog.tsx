'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, FileText, ChevronDown, ChevronUp, ExternalLink, Loader2, Minimize2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { useOpportunityAssistant } from '@/lib/hooks/use-opportunity-assistant';
import { usePresignDownload } from '@/lib/hooks/use-presign';
import type { OpportunityAssistantMessage, ChatSourceCitation } from '@auto-rfp/core';

interface OpportunityChatDialogProps {
  opportunityId: string;
  orgId: string;
  projectId: string;
}

/** Extract just the filename from an S3 path */
const getDisplayFileName = (path: string): string => {
  return path.split('/').pop() || path;
};

interface SourceCitationProps {
  source: ChatSourceCitation;
  index: number;
  onOpenFile: (key: string) => void;
  isOpening: boolean;
}

const SourceCitation = ({ source, index, onOpenFile, isOpening }: SourceCitationProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const displayName = getDisplayFileName(source.fileName);

  const handleFileClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (source.fileName) {
      onOpenFile(source.fileName);
    }
  };

  return (
    <div className="border rounded-md p-2 bg-muted/50 overflow-hidden">
      <div className="flex items-start justify-between w-full text-sm gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <span className="font-medium truncate text-xs" title={displayName}>
              [{index + 1}] {displayName}
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <Badge variant="secondary" className="text-xs whitespace-nowrap">
                {Math.round(source.relevance * 100)}%
              </Badge>
              <button
                type="button"
                onClick={handleFileClick}
                disabled={isOpening}
                className="text-primary hover:text-primary/80 inline-flex items-center gap-1 disabled:opacity-50"
                title="Open file in new tab"
              >
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex-shrink-0 p-1 hover:bg-muted rounded"
          title={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </button>
      </div>
      {isExpanded && (
        <p className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap break-words">
          {source.excerpt}
        </p>
      )}
    </div>
  );
};

interface ChatMessageBubbleProps {
  message: OpportunityAssistantMessage;
  onOpenFile: (key: string) => void;
  isOpening: boolean;
}

const ChatMessageBubble = ({ message, onOpenFile, isOpening }: ChatMessageBubbleProps) => {
  const isUser = message.role === 'user';

  return (
    <div className={cn('flex gap-2', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
          <Bot className="h-3.5 w-3.5 text-primary" />
        </div>
      )}
      <div
        className={cn(
          'max-w-[85%] rounded-lg p-2.5 text-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted'
        )}
      >
        <p className="whitespace-pre-wrap">{message.content}</p>
        {message.sources && message.sources.length > 0 && (
          <div className="mt-2 space-y-1.5">
            <p className="text-xs font-medium opacity-70">Sources:</p>
            {message.sources.map((source, i) => (
              <SourceCitation 
                key={source.sourceId} 
                source={source} 
                index={i}
                onOpenFile={onOpenFile}
                isOpening={isOpening}
              />
            ))}
          </div>
        )}
      </div>
      {isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center">
          <User className="h-3.5 w-3.5 text-primary-foreground" />
        </div>
      )}
    </div>
  );
};

/** Temporary message shown optimistically before server response */
interface PendingMessage {
  content: string;
  createdAt: string;
}

/**
 * Intercom-style floating chat panel.
 * - Stays open while user scrolls the page
 * - Fixed position in bottom-right corner
 * - Click FAB to open, minimize button to close
 */
export const OpportunityChatDialog = ({ opportunityId, orgId, projectId }: OpportunityChatDialogProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [isOpeningFile, setIsOpeningFile] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const {
    messages,
    isLoadingHistory,
    sendMessage,
    isSubmitting,
  } = useOpportunityAssistant(opportunityId, orgId, projectId);
  
  const { trigger: presignDownload } = usePresignDownload();

  // Open file in new tab using presigned URL (secure: noopener, noreferrer)
  const handleOpenFile = async (key: string) => {
    if (isOpeningFile) return;
    
    setIsOpeningFile(true);
    try {
      const presign = await presignDownload({ key });
      if (presign?.url) {
        window.open(presign.url, '_blank', 'noopener,noreferrer');
      }
    } catch {
      toast({
        title: 'Failed to open file',
        description: 'Could not generate download link. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsOpeningFile(false);
    }
  };

  // Scroll to bottom on new messages or pending message
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen, pendingMessage]);

  // Scroll to bottom when history finishes loading
  useEffect(() => {
    if (isOpen && !isLoadingHistory && messages.length > 0) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }, 50);
    }
  }, [isOpen, isLoadingHistory, messages.length]);

  // Clear pending message when messages update (response received)
  useEffect(() => {
    if (pendingMessage && messages.length > 0) {
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg && lastUserMsg.content === pendingMessage.content) {
        setPendingMessage(null);
      }
    }
  }, [messages, pendingMessage]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isSubmitting) return;

    const message = input;
    setInput('');
    
    setPendingMessage({
      content: message,
      createdAt: new Date().toISOString(),
    });
    
    try {
      await sendMessage(message);
    } catch (err) {
      toast({
        title: 'Failed to send message',
        description: err instanceof Error ? err.message : 'Please try again',
        variant: 'destructive',
      });
    } finally {
      setPendingMessage(null);
    }
  };

  return (
    <>
      {/* FAB Button - shown when panel is closed (centered at bottom) */}
      {!isOpen && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <Button 
            size="lg"
            onClick={() => setIsOpen(true)}
            className="h-12 gap-2 rounded-full shadow-lg hover:shadow-xl transition-all bg-primary hover:bg-primary/90 text-primary-foreground px-5"
          >
            <Bot className="h-5 w-5" />
            <span className="font-medium">Ask AI</span>
          </Button>
        </div>
      )}

      {/* Floating Chat Panel - Intercom style (bottom-20 to avoid Sentry button) */}
      {isOpen && (
        <div className="fixed bottom-20 right-6 z-50 w-[380px] h-[500px] flex flex-col bg-background border rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-primary text-primary-foreground">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              <span className="font-semibold">AI Assistant</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 hover:bg-primary-foreground/20 rounded-md transition-colors"
              title="Minimize"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
          </div>
          
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {isLoadingHistory ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-3/4" />
                <Skeleton className="h-16 w-3/4 ml-auto" />
                <Skeleton className="h-12 w-3/4" />
              </div>
            ) : messages.length === 0 && !pendingMessage && !isSubmitting ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                <div className="text-center px-4">
                  <Bot className="h-10 w-10 mx-auto mb-3 opacity-50" />
                  <p className="text-sm">Ask me anything about this opportunity&apos;s documents.</p>
                  <p className="text-xs mt-1.5 text-muted-foreground">Requirements, deadlines, evaluation criteria...</p>
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg) => (
                  <ChatMessageBubble 
                    key={msg.messageId} 
                    message={msg}
                    onOpenFile={handleOpenFile}
                    isOpening={isOpeningFile}
                  />
                ))}
                {/* Optimistic user message */}
                {pendingMessage && (
                  <div className="flex gap-2 justify-end">
                    <div className="max-w-[85%] rounded-lg p-2.5 bg-primary text-primary-foreground text-sm">
                      <p className="whitespace-pre-wrap">{pendingMessage.content}</p>
                    </div>
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center">
                      <User className="h-3.5 w-3.5 text-primary-foreground" />
                    </div>
                  </div>
                )}
                {/* Typing indicator */}
                {isSubmitting && (
                  <div className="flex gap-2 justify-start">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div className="rounded-lg p-2.5 bg-muted text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span className="text-xs">Thinking...</span>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>
          
          {/* Input */}
          <form onSubmit={handleSubmit} className="p-3 border-t flex gap-2 bg-background">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about this opportunity..."
              disabled={isSubmitting}
              className="flex-1 h-9 text-sm"
            />
            <Button type="submit" size="sm" disabled={isSubmitting || !input.trim()} className="h-9 px-3">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
};

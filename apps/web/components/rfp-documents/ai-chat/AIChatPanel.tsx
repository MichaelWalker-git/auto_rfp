'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, ChevronDown, Loader2, Send, Sparkles, User, AlertCircle, Check } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { useEditSection, useChatMessages } from '@/lib/hooks/use-rfp-documents';
import type { EditSectionResponse, ChatMessage as PersistedChatMessage } from '@/lib/hooks/use-rfp-documents';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocumentSection {
  /** The heading text (e.g., "Technical Approach") */
  title: string;
  /** The heading level (1, 2, 3) */
  level: number;
  /** The full HTML of this section (heading + content until next heading of same/higher level) */
  html: string;
  /** Start index in the full document HTML */
  startIndex: number;
  /** End index in the full document HTML */
  endIndex: number;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  sectionTitle?: string;
  /** For assistant messages: the updated HTML that was applied */
  updatedHtml?: string;
  /** Whether this edit was applied to the document */
  applied?: boolean;
  /** Error message if the request failed */
  error?: string;
}

interface AIChatPanelProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  /** Current HTML content of the document */
  htmlContent: string;
  /** Callback to update the document HTML when AI edits a section */
  onApplyEdit: (newFullHtml: string, sectionTitle?: string) => void;
  /** Whether the editor is in a state that prevents editing */
  disabled?: boolean;
}

// ─── Section Parser ───────────────────────────────────────────────────────────

/**
 * Parse the document HTML into sections based on headings (h1, h2, h3).
 * Each section includes the heading and all content until the next heading
 * of the same or higher level.
 */
const parseDocumentSections = (html: string): DocumentSection[] => {
  if (!html?.trim()) return [];

  const sections: DocumentSection[] = [];
  // Match h1, h2, h3 headings
  const headingRegex = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings: Array<{ level: number; title: string; index: number; fullMatch: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(html)) !== null) {
    const level = parseInt(match[1]!, 10);
    // Strip HTML tags from heading text
    const title = match[2]!.replace(/<[^>]+>/g, '').trim();
    if (title) {
      headings.push({
        level,
        title,
        index: match.index,
        fullMatch: match[0],
      });
    }
  }

  if (headings.length === 0) {
    // No headings found — treat the entire document as one section
    if (html.trim()) {
      sections.push({
        title: 'Full Document',
        level: 1,
        html: html.trim(),
        startIndex: 0,
        endIndex: html.length,
      });
    }
    return sections;
  }

  // Build sections: each heading owns content until the next heading of same or higher level
  for (let i = 0; i < headings.length; i++) {
    const current = headings[i]!;
    const startIndex = current.index;

    // Find the end: next heading of same or higher level (lower number)
    let endIndex = html.length;
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j]!.level <= current.level) {
        endIndex = headings[j]!.index;
        break;
      }
    }

    sections.push({
      title: current.title,
      level: current.level,
      html: html.substring(startIndex, endIndex).trim(),
      startIndex,
      endIndex,
    });
  }

  return sections;
};

/**
 * Replace a section in the full document HTML with updated content.
 */
const replaceSectionInDocument = (
  fullHtml: string,
  section: DocumentSection,
  newSectionHtml: string,
): string => {
  const before = fullHtml.substring(0, section.startIndex);
  const after = fullHtml.substring(section.endIndex);
  return before + newSectionHtml + after;
};

// ─── Component ────────────────────────────────────────────────────────────────

export const AIChatPanel = ({
  orgId,
  projectId,
  opportunityId,
  documentId,
  htmlContent,
  onApplyEdit,
  disabled = false,
}: AIChatPanelProps) => {
  const { toast } = useToast();
  const { trigger: triggerEditSection, isMutating: isEditing } = useEditSection(orgId);

  // ── Persisted chat history ──
  const {
    messages: persistedMessages,
    isLoading: isLoadingHistory,
    mutate: mutateChatHistory,
  } = useChatMessages(projectId, opportunityId, documentId, orgId);

  // ── State ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [selectedSectionTitle, setSelectedSectionTitle] = useState<string>('');
  const [showSectionDropdown, setShowSectionDropdown] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Parse sections from current HTML
  const sections = parseDocumentSections(htmlContent);

  // ── Load persisted messages into local state on mount ──
  useEffect(() => {
    if (historyLoaded || isLoadingHistory || persistedMessages.length === 0) return;

    const loaded: ChatMessage[] = persistedMessages.map((pm: PersistedChatMessage) => ({
      id: pm.messageId,
      role: pm.role as 'user' | 'assistant',
      content: pm.content,
      timestamp: new Date(pm.timestamp),
      sectionTitle: pm.sectionTitle,
      applied: pm.applied,
      error: pm.error,
    }));

    setMessages(loaded);
    setHistoryLoaded(true);
  }, [persistedMessages, isLoadingHistory, historyLoaded]);

  // Mark history as loaded even if empty (so we don't keep waiting)
  useEffect(() => {
    if (!isLoadingHistory && !historyLoaded) {
      setHistoryLoaded(true);
    }
  }, [isLoadingHistory, historyLoaded]);

  // Auto-select section: use last edited section from localStorage, or first section
  useEffect(() => {
    if (selectedSectionTitle || sections.length === 0) return;
    const storageKey = `ai-chat-last-section-${documentId}`;
    const lastSection = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null;
    if (lastSection && sections.some(s => s.title === lastSection)) {
      setSelectedSectionTitle(lastSection);
    } else {
      setSelectedSectionTitle(sections[0]!.title);
    }
  }, [sections, selectedSectionTitle, documentId]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowSectionDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-scroll to bottom when new messages arrive or history loads
  useEffect(() => {
    // ScrollArea creates a viewport div — we need to scroll that, not the inner content div
    const scrollToBottom = () => {
      // Try the inner ref first
      if (scrollRef.current) {
        // Find the ScrollArea viewport (parent with overflow)
        const viewport = scrollRef.current.closest('[data-radix-scroll-area-viewport]')
          ?? scrollRef.current.parentElement;
        if (viewport) {
          viewport.scrollTop = viewport.scrollHeight;
        }
      }
    };
    // Use double rAF to ensure DOM is fully painted
    requestAnimationFrame(() => requestAnimationFrame(scrollToBottom));
  }, [messages, historyLoaded]);

  const selectedSection = sections.find(s => s.title === selectedSectionTitle);

  // ── Send message ──
  const handleSend = useCallback(async () => {
    const instruction = inputValue.trim();
    if (!instruction || !selectedSection || isEditing || disabled) return;

    const userMessageId = `msg-${Date.now()}-user`;
    const assistantMessageId = `msg-${Date.now()}-assistant`;

    // Add user message
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: 'user',
      content: instruction,
      timestamp: new Date(),
      sectionTitle: selectedSection.title,
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');

    // Add placeholder assistant message (loading)
    const loadingMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      sectionTitle: selectedSection.title,
    };
    setMessages(prev => [...prev, loadingMessage]);

    try {
      const response: EditSectionResponse = await triggerEditSection({
        projectId,
        opportunityId,
        documentId,
        sectionTitle: selectedSection.title,
        currentSectionHtml: selectedSection.html,
        instruction,
      });

      // Apply the edit to the document and scroll to the updated section
      const newFullHtml = replaceSectionInDocument(htmlContent, selectedSection, response.updatedHtml);
      onApplyEdit(newFullHtml, selectedSection.title);

      // Update assistant message with success
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMessageId
            ? {
                ...m,
                content: `Updated section "${selectedSection.title}" successfully.${
                  response.toolRoundsUsed > 0
                    ? ` Used ${response.toolRoundsUsed} tool round${response.toolRoundsUsed > 1 ? 's' : ''} to gather context.`
                    : ''
                }`,
                updatedHtml: response.updatedHtml,
                applied: true,
                timestamp: new Date(),
              }
            : m,
        ),
      );

      toast({
        title: 'Section updated',
        description: `"${selectedSection.title}" has been updated by AI.`,
      });

      // Save last edited section to localStorage for default selection
      try {
        localStorage.setItem(`ai-chat-last-section-${documentId}`, selectedSection.title);
      } catch { /* ignore localStorage errors */ }

      // Refresh persisted chat history (non-blocking)
      mutateChatHistory();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to edit section';

      // Update assistant message with error
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMessageId
            ? {
                ...m,
                content: `Failed to edit section: ${errorMsg}`,
                error: errorMsg,
                timestamp: new Date(),
              }
            : m,
        ),
      );

      toast({
        title: 'Edit failed',
        description: errorMsg,
        variant: 'destructive',
      });
    }
  }, [
    inputValue,
    selectedSection,
    isEditing,
    disabled,
    triggerEditSection,
    projectId,
    opportunityId,
    documentId,
    htmlContent,
    onApplyEdit,
    toast,
    mutateChatHistory,
  ]);

  // Handle Enter key (Shift+Enter for newline)
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // ── Render ──
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Section Selector */}
      <div className="p-3 border-b border-border/50">
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setShowSectionDropdown(!showSectionDropdown)}
            disabled={disabled || sections.length === 0}
            className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg border border-input bg-background hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="truncate text-left">
                {selectedSection ? selectedSection.title : 'Select a section…'}
              </span>
            </div>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${showSectionDropdown ? 'rotate-180' : ''}`} />
          </button>

          {showSectionDropdown && sections.length > 0 && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {sections.map((section) => (
                <button
                  key={`${section.title}-${section.startIndex}`}
                  type="button"
                  onClick={() => {
                    setSelectedSectionTitle(section.title);
                    setShowSectionDropdown(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors flex items-center gap-2 ${
                    selectedSectionTitle === section.title
                      ? 'bg-primary/5 text-primary font-medium'
                      : 'text-foreground'
                  }`}
                  style={{ paddingLeft: `${(section.level - 1) * 12 + 12}px` }}
                >
                  <span className="text-xs text-muted-foreground shrink-0">H{section.level}</span>
                  <span className="truncate">{section.title}</span>
                  {selectedSectionTitle === section.title && (
                    <Check className="h-3.5 w-3.5 ml-auto shrink-0 text-primary" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chat Messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div ref={scrollRef} className="p-3 space-y-3">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="rounded-full bg-primary/10 p-3 mb-3">
                <Bot className="h-6 w-6 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground mb-1">AI Section Editor</p>
              <p className="text-xs text-muted-foreground max-w-[240px]">
                Select a section above, then type your instructions to edit it with AI assistance.
              </p>
              <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
                <p>💡 Try:</p>
                <p className="italic">&quot;Add more detail about our cloud migration experience&quot;</p>
                <p className="italic">&quot;Make this section more concise&quot;</p>
                <p className="italic">&quot;Add a compliance matrix table&quot;</p>
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div className="shrink-0 mt-0.5">
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : msg.error
                      ? 'bg-destructive/10 border border-destructive/20'
                      : 'bg-muted'
                  }`}
                >
                  {/* Section badge */}
                  {msg.sectionTitle && (
                    <div className="mb-1">
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${
                          msg.role === 'user'
                            ? 'border-primary-foreground/30 text-primary-foreground/80'
                            : 'border-border'
                        }`}
                      >
                        {msg.sectionTitle}
                      </Badge>
                    </div>
                  )}

                  {/* Message content */}
                  {msg.role === 'assistant' && !msg.content && !msg.error ? (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span className="text-xs">Editing section…</span>
                    </div>
                  ) : msg.error ? (
                    <div className="flex items-start gap-2 text-destructive">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>{msg.content}</span>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}

                  {/* Applied indicator */}
                  {msg.applied && (
                    <div className="flex items-center gap-1 mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                      <Check className="h-3 w-3" />
                      <span>Applied to document</span>
                    </div>
                  )}

                  {/* Timestamp */}
                  <p
                    className={`text-[10px] mt-1 ${
                      msg.role === 'user'
                        ? 'text-primary-foreground/60'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>

                {msg.role === 'user' && (
                  <div className="shrink-0 mt-0.5">
                    <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                      <User className="h-3.5 w-3.5 text-primary-foreground" />
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      {/* Input Area */}
      <div className="p-3 border-t border-border/50">
        <div className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              !selectedSection
                ? 'Select a section first…'
                : isEditing
                ? 'AI is editing…'
                : 'Type instructions for AI…'
            }
            disabled={disabled || isEditing || !selectedSection}
            className="min-h-[40px] max-h-[120px] resize-none text-sm"
            rows={1}
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={disabled || isEditing || !inputValue.trim() || !selectedSection}
            className="shrink-0 h-10 w-10 p-0"
            title="Send instruction to AI"
          >
            {isEditing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
};

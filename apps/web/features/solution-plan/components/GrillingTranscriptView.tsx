'use client';

import { useEffect, useRef } from 'react';
import { HelpCircle, Wrench } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { GrillingMessageListItem } from '@auto-rfp/core';

interface GrillingTranscriptViewProps {
  messages: GrillingMessageListItem[];
  isLoading?: boolean;
}

/**
 * Live Q&A feed of the grilling interview: Griller questions on the left,
 * Tech Lead answers on the right, round separators between rounds, and
 * compact chips for the Tech Lead's tool calls. Auto-scrolls to the newest
 * message while the interview is running.
 */
export const GrillingTranscriptView = ({ messages, isLoading = false }: GrillingTranscriptViewProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  if (isLoading && messages.length === 0) {
    return (
      <div className="space-y-3" data-testid="transcript-skeleton">
        <Skeleton className="h-16 w-3/4" />
        <Skeleton className="h-16 w-2/3 ml-auto" />
        <Skeleton className="h-16 w-3/4" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        The interview is starting — the first question will appear here shortly.
      </p>
    );
  }

  let lastRound = 0;

  return (
    <div ref={scrollRef} className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
      {messages.map((msg) => {
        const isNewRound = msg.round !== lastRound;
        lastRound = msg.round;

        return (
          <div key={msg.id} className="space-y-3">
            {isNewRound && (
              <div className="flex items-center gap-3 pt-1">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs font-medium text-muted-foreground">
                  Round {msg.round}
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
            )}

            {msg.role === 'SYSTEM' ? (
              <p className="text-xs text-muted-foreground text-center italic">{msg.content}</p>
            ) : (
              <Card
                className={
                  msg.role === 'GRILLER'
                    ? 'p-3 bg-muted max-w-[85%]'
                    : 'p-3 ml-auto max-w-[85%]'
                }
              >
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  {msg.role === 'GRILLER' && <HelpCircle className="h-3.5 w-3.5" aria-hidden />}
                  {msg.role === 'GRILLER' ? 'Interviewer' : 'Tech Lead'}
                </p>
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {msg.toolCalls.map((call, i) => (
                      <Badge key={`${msg.id}-tool-${i}`} variant="secondary" title={call.summary}>
                        <Wrench aria-hidden />
                        {call.toolName}
                      </Badge>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </div>
        );
      })}
    </div>
  );
};

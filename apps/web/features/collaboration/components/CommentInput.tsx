'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { SendHorizontal } from 'lucide-react';
import { useUsersList } from '@/lib/hooks/use-user';
import type { UserListItem } from '@auto-rfp/core';

interface CommentInputProps {
  onSubmit: (content: string, mentionedUserIds: string[]) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
  /** orgId needed to fetch members for @mention */
  orgId?: string;
}

export function CommentInput({
  onSubmit,
  placeholder = 'Type a message… (@ to mention)',
  disabled = false,
  orgId,
}: CommentInputProps) {
  const [content, setContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null = not in mention mode
  const [mentionStart, setMentionStart] = useState(0); // cursor position where @ was typed
  const [selectedIndex, setSelectedIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Track mentioned user IDs for the DTO
  const mentionedUserIds = useRef<string[]>([]);

  // Fetch org members for mention suggestions
  const { data: usersData } = useUsersList(orgId ?? '', {
    search: mentionQuery ?? undefined,
    limit: 8,
  });

  const suggestions: UserListItem[] = mentionQuery !== null
    ? (usersData?.items ?? []).filter((u) =>
        !mentionQuery ||
        u.displayName?.toLowerCase().includes(mentionQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(mentionQuery.toLowerCase()),
      ).slice(0, 6)
    : [];

  // Reset selected index when suggestions change
  useEffect(() => {
    setSelectedIndex(0);
  }, [suggestions.length]);

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit(trimmed, [...new Set(mentionedUserIds.current)]);
      setContent('');
      mentionedUserIds.current = [];
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } finally {
      setIsSubmitting(false);
    }
  };

  const insertMention = useCallback((user: UserListItem) => {
    const name = user.displayName || user.email;
    const before = content.slice(0, mentionStart);
    const after = content.slice(textareaRef.current?.selectionStart ?? content.length);
    const newContent = `${before}@${name} ${after}`;
    setContent(newContent);
    setMentionQuery(null);
    mentionedUserIds.current.push(user.userId);

    // Move cursor after the inserted mention
    setTimeout(() => {
      const pos = before.length + name.length + 2; // @name + space
      textareaRef.current?.setSelectionRange(pos, pos);
      textareaRef.current?.focus();
    }, 0);
  }, [content, mentionStart]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);

    // Auto-grow
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;

    // Detect @mention trigger
    const cursor = el.selectionStart;
    const textBefore = val.slice(0, cursor);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch) {
      setMentionQuery(atMatch[1] ?? '');
      setMentionStart(cursor - (atMatch[1]?.length ?? 0) - 1); // position of @
    } else {
      setMentionQuery(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Navigate mention dropdown
    if (mentionQuery !== null && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const user = suggestions[selectedIndex];
        if (user) insertMention(user);
        return;
      }
      if (e.key === 'Escape') {
        setMentionQuery(null);
        return;
      }
    }

    // Enter without shift = send
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="relative">
      {/* @mention dropdown */}
      {mentionQuery !== null && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute bottom-full left-0 right-0 mb-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden z-10"
        >
          {suggestions.map((user, i) => (
            <button
              key={user.userId}
              type="button"
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                i === selectedIndex ? 'bg-indigo-50 text-indigo-700' : 'hover:bg-slate-50 text-slate-700'
              }`}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent textarea blur
                insertMention(user);
              }}
            >
              <div className="h-6 w-6 rounded-full bg-indigo-500 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                {(user.displayName || user.email).charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="font-medium truncate">{user.displayName || user.email}</div>
                {user.displayName && (
                  <div className="text-xs text-slate-400 truncate">{user.email}</div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled || isSubmitting}
          rows={1}
          className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent transition-shadow disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ minHeight: '36px', maxHeight: '120px' }}
        />
        <Button
          size="icon"
          className="h-9 w-9 shrink-0 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white"
          onClick={handleSubmit}
          disabled={!content.trim() || isSubmitting || disabled}
          title="Send (Enter)"
        >
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

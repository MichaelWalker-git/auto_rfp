'use client';

import { useRef, useEffect, useMemo } from 'react';
import type { CommentItem, CommentEntityType, CreateCommentDTO, UserListItem } from '@auto-rfp/core';
import { useComments } from '../hooks/useComments';
import { CommentInput } from './CommentInput';
import { Skeleton } from '@/components/ui/skeleton';
import { useUsersList } from '@/lib/hooks/use-user';

interface CommentThreadProps {
  projectId: string;
  orgId: string;
  entityType: CommentEntityType;
  entityId: string;
  entityPk: string;
  entitySk: string;
  currentUserId: string;
  canComment: boolean;
}

/** Parse comment content and render @mentions as clickable links to the user's profile */
function renderContent(
  content: string,
  orgId: string,
  isOwn: boolean,
  usersByName: Map<string, string>,
) {
  const parts = content.split(/(@\S+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const name = part.slice(1);
      const userId = usersByName.get(name.toLowerCase());
      const href = userId
        ? `/organizations/${orgId}/team/${userId}`
        : `/organizations/${orgId}/team`;
      return (
        <a
          key={i}
          href={href}
          className={`font-semibold underline cursor-pointer ${
            isOwn
              ? 'text-indigo-100 hover:text-white'
              : 'text-indigo-600 hover:text-indigo-800'
          }`}
          title={`View ${name}'s profile`}
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function avatarColor(userId: string): string {
  const colors = [
    'bg-indigo-500', 'bg-violet-500', 'bg-pink-500',
    'bg-rose-500', 'bg-orange-500', 'bg-teal-500',
    'bg-cyan-500', 'bg-emerald-500',
  ];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length]!;
}

export function CommentThread({
  projectId,
  orgId,
  entityType,
  entityId,
  entityPk,
  entitySk,
  currentUserId,
  canComment,
}: CommentThreadProps) {
  const { comments, isLoading, createComment, resolveComment, deleteComment } = useComments(
    projectId,
    orgId,
    entityType,
    entityId,
  );

  // Fetch org members to resolve @mention names → userId for profile links
  const { data: usersData } = useUsersList(orgId, { limit: 200 });
  const usersByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of usersData?.items ?? []) {
      const displayName = u.displayName || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;
      // Map various name forms to userId so @mentions can be resolved
      if (displayName) map.set(displayName.toLowerCase(), u.userId);
      if (u.email) map.set(u.email.toLowerCase(), u.userId);
      if (u.firstName) map.set(u.firstName.toLowerCase(), u.userId);
      const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ');
      if (fullName) map.set(fullName.toLowerCase(), u.userId);
    }
    return map;
  }, [usersData?.items]);

  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [comments.length]);

  const handleSubmit = async (content: string, mentionedUserIds: string[] = []) => {
    const dto: CreateCommentDTO = {
      projectId,
      orgId,
      entityType,
      entityId,
      entityPk,
      entitySk,
      content,
      mentions: mentionedUserIds,
    };
    await createComment(dto);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 p-4 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={`flex gap-2 ${i % 2 === 0 ? '' : 'flex-row-reverse'}`}>
              <Skeleton className="h-7 w-7 rounded-full shrink-0" />
              <Skeleton className={`h-14 rounded-2xl ${i % 2 === 0 ? 'w-3/4' : 'w-2/3'}`} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {comments.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center">
            <div className="text-2xl mb-2">💬</div>
            <p className="text-sm text-slate-400">No comments yet</p>
            {canComment && (
              <p className="text-xs text-slate-300 mt-1">Be the first to comment</p>
            )}
          </div>
        )}

        {/* Sort oldest→newest so newest messages appear at bottom */}
        {[...comments].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).map((comment: CommentItem) => {
          const isOwn = comment.userId === currentUserId;
          const initials = comment.displayName
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);

          return (
            <div
              key={comment.commentId}
              className={`flex gap-2 items-end ${isOwn ? 'flex-row-reverse' : ''}`}
            >
              {/* Avatar */}
              <div
                className={`h-7 w-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 ${avatarColor(comment.userId)}`}
                title={comment.displayName}
              >
                {initials}
              </div>

              {/* Bubble */}
              <div className={`max-w-[75%] group ${isOwn ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                {/* Name + time */}
                {!isOwn && (
                  <span className="text-[10px] text-slate-400 px-1">
                    {comment.displayName}
                  </span>
                )}

                <div
                  className={`relative px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                    isOwn
                      ? 'bg-indigo-500 text-white rounded-br-sm'
                      : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                  } ${comment.resolved ? 'opacity-60' : ''}`}
                >
                  {renderContent(comment.content, orgId, isOwn, usersByName)}
                  {comment.resolved && (
                    <span className={`ml-2 text-[10px] ${isOwn ? 'text-indigo-200' : 'text-slate-400'}`}>
                      ✓ resolved
                    </span>
                  )}
                </div>

                {/* Timestamp + actions */}
                <div className={`flex items-center gap-2 px-1 ${isOwn ? 'flex-row-reverse' : ''}`}>
                  <span className="text-[10px] text-slate-300">{timeAgo(comment.createdAt)}</span>

                  {/* Actions — visible on hover */}
                  <div className="hidden group-hover:flex items-center gap-1">
                    {canComment && !comment.resolved && (
                      <button
                        className="text-[10px] text-slate-400 hover:text-emerald-600 transition-colors"
                        onClick={() => resolveComment(comment.commentId, true)}
                      >
                        Resolve
                      </button>
                    )}
                    {comment.resolved && canComment && (
                      <button
                        className="text-[10px] text-slate-400 hover:text-slate-600 transition-colors"
                        onClick={() => resolveComment(comment.commentId, false)}
                      >
                        Unresolve
                      </button>
                    )}
                    {comment.userId === currentUserId && (
                      <button
                        className="text-[10px] text-slate-400 hover:text-red-500 transition-colors"
                        onClick={() => deleteComment(comment.commentId)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* Input pinned at bottom */}
      {canComment && (
        <div className="border-t border-slate-100 px-3 py-2 bg-white shrink-0">
          <CommentInput
            onSubmit={handleSubmit}
            placeholder="Type a message… (@ to mention)"
            orgId={orgId}
          />
        </div>
      )}
    </div>
  );
}

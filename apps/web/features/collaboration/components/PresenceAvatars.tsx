'use client';

import type { PresenceItem } from '@auto-rfp/core';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface PresenceAvatarsProps {
  users: PresenceItem[];
  maxVisible?: number;
}

const STATUS_COLORS: Record<string, string> = {
  editing: 'bg-amber-400',
  reviewing: 'bg-blue-400',
  generating: 'bg-purple-400',
  viewing: 'bg-emerald-400',
};

export function PresenceAvatars({ users, maxVisible = 5 }: PresenceAvatarsProps) {
  const visible = users.slice(0, maxVisible);
  const overflow = users.length - maxVisible;

  return (
    <div className="flex items-center -space-x-2">
      {visible.map((user) => (
        <Tooltip key={user.userId}>
          <TooltipTrigger asChild>
            <div className="relative">
              <div className="h-8 w-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs font-semibold ring-2 ring-white cursor-default select-none">
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <span
                className={`absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-1 ring-white ${STATUS_COLORS[user.status] ?? 'bg-slate-400'}`}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p className="font-medium">{user.displayName}</p>
            <p className="text-xs text-slate-400 capitalize">{user.status}</p>
            {user.questionId && (
              <p className="text-xs text-slate-400">on Q{user.questionId.slice(-4)}</p>
            )}
          </TooltipContent>
        </Tooltip>
      ))}
      {overflow > 0 && (
        <div className="h-8 w-8 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 text-xs font-semibold ring-2 ring-white">
          +{overflow}
        </div>
      )}
    </div>
  );
}

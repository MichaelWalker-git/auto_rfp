'use client';

import React from 'react';
import type { SavedSearch } from '@auto-rfp/core';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BaseCard } from '@/components/ui/base-card';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import {
  Bell,
  Calendar,
  Clock,
  ExternalLink,
  Play,
  RefreshCw,
  Trash2,
  Zap,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (iso?: string | null): string => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const fmtRelative = (iso?: string | null): string => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(iso);
};

const FREQ_LABEL: Record<string, string> = {
  HOURLY: 'Hourly',
  DAILY: 'Daily',
  WEEKLY: 'Weekly',
};

const SOURCE_LABEL: Record<string, string> = {
  SAM_GOV: 'SAM.gov',
  DIBBS: 'DIBBS',
};

// ─── Component ────────────────────────────────────────────────────────────────

interface SavedSearchCardProps {
  savedSearch: SavedSearch;
  onRun: (s: SavedSearch) => void;
  onDelete: (s: SavedSearch) => void;
  onToggleEnabled: (s: SavedSearch) => void;
  disabled?: boolean;
}

export const SavedSearchCard = ({
  savedSearch: s,
  onRun,
  onDelete,
  onToggleEnabled,
  disabled = false,
}: SavedSearchCardProps) => {
  const sourceLabel = SOURCE_LABEL[s.source ?? 'SAM_GOV'] ?? 'SAM.gov';
  const freqLabel = FREQ_LABEL[s.frequency] ?? s.frequency;

  // Build a short subtitle from key criteria
  const parts: string[] = [];
  if (s.criteria.keywords) parts.push(`"${s.criteria.keywords}"`);
  if (s.criteria.naics?.length) parts.push(`NAICS: ${s.criteria.naics.join(', ')}`);
  if (s.criteria.setAsideCode) parts.push(s.criteria.setAsideCode);
  const subtitle = parts.length > 0 ? parts.join(' · ') : 'All opportunities';

  return (
    <div className={!s.isEnabled ? 'opacity-60' : ''}>
      <BaseCard
        title={s.name}
        subtitle={subtitle}
        isHoverable
        onClick={() => onRun(s)}
        actions={
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="flex items-center"
                  onClick={(e) => { e.stopPropagation(); }}
                >
                  <Switch
                    checked={Boolean(s.isEnabled)}
                    onCheckedChange={() => onToggleEnabled(s)}
                    disabled={disabled}
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent>{s.isEnabled ? 'Pause' : 'Enable'}</TooltipContent>
            </Tooltip>

            <Button
              variant="ghost"
              size="icon"
              className="rounded-xl"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRun(s);
              }}
              aria-label="Run search"
              title="Run search"
            >
              <Play className="h-3.5 w-3.5" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="rounded-xl hover:bg-destructive/10 hover:text-destructive"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(s);
              }}
              aria-label="Delete search"
              title="Delete search"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        }
        footer={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {sourceLabel}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              <RefreshCw className="mr-1 h-3 w-3" />
              {freqLabel}
            </Badge>
            {s.autoImport && (
              <Badge variant="secondary" className="text-xs text-emerald-600 dark:text-emerald-400">
                <Zap className="mr-1 h-3 w-3" />
                Auto
              </Badge>
            )}
            <span className="text-xs text-muted-foreground/70 ml-auto flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {fmtRelative(s.lastRunAt)}
            </span>
            {(s.notifyEmails?.length ?? 0) > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-xs text-muted-foreground/70 flex items-center gap-1">
                    <Bell className="h-3 w-3" />
                    {s.notifyEmails!.length}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="space-y-0.5">
                    <div className="font-medium text-xs">Notifications</div>
                    {s.notifyEmails!.map((email, i) => (
                      <div key={i} className="text-xs">{email}</div>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        }
      />
    </div>
  );
};

'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command';
import PermissionWrapper from '@/components/permission-wrapper';
import { Separator } from '@/components/ui/separator';
import { Calendar, Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

import type { SamOpportunitySlim } from '@auto-rfp/shared';
import { fmtDate } from '@/components/opportunities/samgov-utils';
import { CreateProjectDialog } from '../organization-badge';

export type ProjectOption = { id: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;

  orgId: string;
  opportunity: SamOpportunitySlim | null;

  projects: ProjectOption[];
  isImporting: boolean;

  onImport: (args: { orgId: string; projectId: string; noticeId: string }) => Promise<void>;
};

const LAST_PROJECT_KEY = 'autorfp:lastImportProjectId';

export function ImportSolicitationDialog({
                                           open,
                                           onOpenChange,
                                           orgId,
                                           opportunity,
                                           projects,
                                           isImporting,
                                           onImport,
                                         }: Props) {
  const [projectId, setProjectId] = React.useState<string>('');
  const [projectOpen, setProjectOpen] = React.useState(false);
  const [error, setError] = React.useState<string>('');
  const [createDialogOpen, setCreateDialogOpen] = React.useState<boolean>(false);

  const noticeId = opportunity?.noticeId ?? '';
  const title = opportunity?.title ?? '(No title)';
  const isActive = (opportunity?.active as any) === true || opportunity?.active === 'Yes';

  React.useEffect(() => {
    if (!open) return;

    setError('');

    setProjectId((prev) => {
      if (prev) return prev;
      try {
        const last = localStorage.getItem(LAST_PROJECT_KEY) || '';
        if (last && projects.some((p) => p.id === last)) return last;
      } catch {}
      return '';
    });
  }, [open, projects]);

  React.useEffect(() => {
    if (!open) {
      setProjectOpen(false);
      setError('');
      setProjectId('');
    }
  }, [open]);

  const selectedProject = React.useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);

  const canImport = !!projectId && !!noticeId && !isImporting;

  const handleImport = async () => {
    setError('');

    if (!projectId) {
      setError('Please select a project.');
      return;
    }
    if (!noticeId) {
      setError('Missing notice ID.');
      return;
    }

    try {
      await onImport({ orgId, projectId, noticeId });
      try {
        localStorage.setItem(LAST_PROJECT_KEY, projectId);
      } catch {}
      onOpenChange(false);
    } catch (e: any) {
      setError(e?.message ?? 'Import failed');
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => !isImporting && onOpenChange(v)}>
      <DialogContent className="sm:max-w-[800px] max-h-[85vh] overflow-hidden">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex items-center gap-2 min-w-0">
            <span className="truncate">Import solicitation</span>
            {isActive ? <Badge className="ml-1 shrink-0">Active</Badge> : null}
          </DialogTitle>
          <DialogDescription>
            Pick a project. We’ll download attachments, upload to S3, create QuestionFiles, and start the pipeline.
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 overflow-y-auto pr-1 -mr-1">
          <div className="rounded-2xl border bg-muted/20 p-4 min-w-0">
            <div className="flex items-start justify-between gap-3 min-w-0">
              <div className="min-w-0">
                <div className="font-medium break-words leading-5">{title}</div>
                <div className="mt-1 text-xs text-muted-foreground break-words">
                  Notice ID: <span className="font-mono">{noticeId || '—'}</span>
                  {opportunity?.solicitationNumber ? (
                    <>
                      {' '}
                      • Sol: <span className="font-mono">{opportunity.solicitationNumber}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <Separator className="my-3" />

            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div className="flex items-center gap-2 min-w-0">
                <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground shrink-0">Posted:</span>
                <span className="font-medium truncate">{fmtDate(opportunity?.postedDate) || '—'}</span>
              </div>

              <div className="flex items-center gap-2 min-w-0">
                <Calendar className="h-4 w-4 text-destructive shrink-0" />
                <span className="text-muted-foreground shrink-0">Due:</span>
                <span className="font-medium truncate">{fmtDate(opportunity?.responseDeadLine) || '—'}</span>
              </div>

              {opportunity?.naicsCode ? (
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="text-muted-foreground shrink-0">NAICS:</span>
                  <Badge variant="outline" className="max-w-full truncate">
                    {opportunity.naicsCode}
                  </Badge>
                </div>
              ) : null}

              {opportunity?.classificationCode ? (
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="text-muted-foreground shrink-0">PSC:</span>
                  <Badge variant="outline" className="max-w-full truncate">
                    {opportunity.classificationCode}
                  </Badge>
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-2 mt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium">Project</div>
              <div className="text-xs text-muted-foreground shrink-0">
                {projects.length ? `${projects.length} available` : 'No projects'}
              </div>
            </div>

            <Popover open={projectOpen} onOpenChange={setProjectOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={projectOpen}
                  disabled={!projects.length || isImporting}
                  className={cn('w-full justify-between rounded-xl min-w-0', !selectedProject && 'text-muted-foreground')}
                >
                  <span className="truncate">
                    {selectedProject?.name ?? (projects.length ? 'Select a project…' : 'No projects found')}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>

              <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search projects…" />
                  <CommandList>
                    <CommandEmpty>No projects found.</CommandEmpty>
                    <CommandGroup>
                      {projects.map((p) => (
                        <CommandItem
                          key={p.id}
                          value={p.name}
                          onSelect={() => {
                            setProjectId(p.id);
                            setProjectOpen(false);
                            setError('');
                          }}
                        >
                          <Check className={cn('mr-2 h-4 w-4', projectId === p.id ? 'opacity-100' : 'opacity-0')} />
                          <span className="truncate">{p.name}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                    <PermissionWrapper requiredPermission={'project:create'}>
                      <CommandSeparator />
                      <CommandItem
                        onSelect={(e) => {
                          setCreateDialogOpen(true);
                        }}
                        className="cursor-pointer"
                      >
                        <Plus className="mr-2 size-4" />
                        <span>Create project</span>
                      </CommandItem>
                    </PermissionWrapper>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {error ? (
              <div className="text-xs text-destructive">{error}</div>
            ) : (
              <div className="text-xs text-muted-foreground">Tip: we’ll remember your last selected project for next imports.</div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isImporting} className="rounded-xl">
            Cancel
          </Button>

          <Button onClick={handleImport} disabled={!canImport} className="rounded-xl">
            {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {isImporting ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>

        <div className="pt-1 text-[11px] text-muted-foreground">
          Attachments will be downloaded from SAM.gov links and stored in your S3 documents bucket.
        </div>
      </DialogContent>
    </Dialog>

    <CreateProjectDialog 
      orgId={orgId} 
      open={createDialogOpen}
      setOpen={setCreateDialogOpen}
    />
    </>
  );
}
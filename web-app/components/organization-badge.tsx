'use client';

import { useMemo, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ChevronsUpDown, Loader2, Plus } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';

import { useOrganization } from '@/context/organization-context';
import { useProjectContext } from '@/context/project-context';
import { useCreateProject } from '@/lib/hooks/use-create-project';
import PermissionWrapper from '@/components/permission-wrapper';

type CreateDialogProps = {
  orgId: string | undefined;
  open: boolean;
  setOpen: (open: boolean) => void;
};

function initialsFromName(name?: string | null) {
  const t = (name ?? '').trim();
  if (!t) return '?';
  return t.slice(0, 1).toUpperCase();
}

export function OrganizationBadge() {
  const { isMobile, open } = useSidebar();

  const { currentOrganization, loading: orgLoading } = useOrganization();
  const orgId = currentOrganization?.id ?? null;

  const { projects, currentProject, setCurrentProject, loading: projectsLoading, refreshProjects } =
    useProjectContext();


  const loading = orgLoading || projectsLoading;

  const orgLabel = useMemo(() => {
    if (loading) return 'Loading…';
    return currentOrganization?.name ?? 'No organization';
  }, [loading, currentOrganization?.name]);

  const projectLabel = useMemo(() => {
    if (!orgId) return 'Select organization first';
    if (loading) return 'Loading…';
    return currentProject?.name ?? 'Select project';
  }, [orgId, loading, currentProject?.name]);

  const orgInitials = useMemo(
    () => initialsFromName(currentOrganization?.name),
    [currentOrganization?.name],
  );

  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  if (loading) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size={open ? 'lg' : 'sm'} className="h-14 animate-pulse">
            <div className="flex size-8 items-center justify-center rounded-md bg-gray-200" />
            <div className="flex-1 space-y-1">
              <div className="h-4 w-28 rounded bg-gray-200" />
              <div className="h-3 w-20 rounded bg-gray-200" />
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  // If no org selected, show a non-interactive badge
  if (!orgId) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size={open ? 'lg' : 'sm'}
            className="group-data-[collapsible=icon]:!p-0 flex h-14 w-full items-center justify-between rounded-md border bg-white py-4 shadow-none"
            tooltip="Organization"
            disabled
          >
            <div className="flex size-8 items-center justify-center rounded-md bg-gray-400 text-white text-sm font-medium">
              ?
            </div>

            <div className="flex flex-col items-start group-data-[collapsible=icon]:hidden">
              <span className="font-medium text-sm truncate max-w-[170px]">No organization</span>
              <span className="text-xs text-muted-foreground">Select organization first</span>
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  // Org selected → dropdown switches PROJECTS (but badge shows org branding)
  return (
    <>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton
                size={open ? 'lg' : 'sm'}
                className="group-data-[collapsible=icon]:!p-0 flex h-14 w-full items-center justify-between rounded-md border bg-white py-4 shadow-none hover:bg-gray-50 focus:outline-none group-data-[collapsible=icon]:mt-4 group-data-[collapsible=icon]:h-auto"
                tooltip="Project"
              >
                <div className="flex size-8 items-center justify-center rounded-md bg-purple-600 text-white text-sm font-medium">
                  {orgInitials}
                </div>

                <div className="flex flex-col items-start overflow-hidden text-ellipsis whitespace-nowrap group-data-[collapsible=icon]:hidden">
                  <span className="font-medium text-sm truncate max-w-[170px]">{orgLabel}</span>
                  <span className="text-xs text-muted-foreground truncate max-w-[170px]">
                    {projectLabel}
                  </span>
                </div>

                <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
              </SidebarMenuButton>
            </DropdownMenuTrigger>

            <DropdownMenuContent
              className="flex w-[260px] flex-col rounded-md border border-gray-200 p-0 shadow-md"
              side={isMobile ? 'bottom' : 'right'}
              sideOffset={10}
            >
              <DropdownMenuLabel className="flex flex-col">
                <span className="text-xs text-muted-foreground">Organization</span>
                <span className="truncate">{currentOrganization?.name ?? '—'}</span>
              </DropdownMenuLabel>

              <DropdownMenuSeparator />

              <DropdownMenuLabel>Projects</DropdownMenuLabel>

              <div className="max-h-[280px] overflow-y-auto p-2 pt-0">
                {projects.map((p) => {
                  const active = p.id === currentProject?.id;
                  return (
                    <DropdownMenuItem
                      key={p.id}
                      disabled={active}
                      onSelect={() => setCurrentProject(p)}
                      className="cursor-pointer"
                    >
                      <span className="truncate">{p.name}</span>
                    </DropdownMenuItem>
                  );
                })}

                {projects.length === 0 && (
                  <div className="px-2 py-2 text-sm text-muted-foreground">No projects yet</div>
                )}
              </div>

              <PermissionWrapper requiredPermission={'project:create'}>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setCreateDialogOpen(true);
                  }}
                  className="cursor-pointer"
                >
                  <Plus className="mr-2 size-4" />
                  <span>Create project</span>
                </DropdownMenuItem>
              </PermissionWrapper>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      <CreateProjectDialog 
        orgId={orgId}
        open={createDialogOpen}
        setOpen={setCreateDialogOpen}
      />
      
    </>
  );
}

export function CreateProjectDialog({ orgId, open, setOpen }: CreateDialogProps) {

  const { toast } = useToast();
  const { createProject } = useCreateProject();
  const { projects, setCurrentProject, refreshProjects } =
    useProjectContext();

  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });

  const handleCreate = async () => {
    if (!orgId) {
      toast({ title: 'Error', description: 'Select an organization first', variant: 'destructive' });
      return;
    }

    const name = form.name.trim();
    if (!name) {
      toast({ title: 'Error', description: 'Project name is required', variant: 'destructive' });
      return;
    }

    try {
      setIsCreating(true);

      const created = await createProject({
        orgId,
        name,
        description: form.description.trim() || undefined,
      } as any);

      if (!created?.id) {
        toast({ title: 'Error', description: 'Failed to create project', variant: 'destructive' });
        return;
      }

      await refreshProjects();

      const next = projects.find((p) => p.id === created.id) || (created as any);
      if (next) setCurrentProject(next);

      toast({ title: 'Success', description: 'Project created' });
      setOpen(false);
      setForm({ name: '', description: '' });
    } catch (e: any) {
      toast({
        title: 'Error',
        description: e instanceof Error ? e.message : 'Failed to create project',
        variant: 'destructive',
      });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Create Project</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="My Project"
                disabled={isCreating}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="project-description">Description</Label>
              <Textarea
                id="project-description"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                placeholder="Optional…"
                disabled={isCreating}
              />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={isCreating}>
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={isCreating}>
                {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isCreating ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
  );
}
'use client';

import { useCallback, useMemo, useState } from 'react';
import { mutate as globalMutate } from 'swr';
import { useToast } from '@/components/ui/use-toast';
import type {
  ConfirmDisclosureRow,
  DisclosureLevel,
  PastProject,
} from '@auto-rfp/core';
import { getPendingDisclosure } from '../lib/effective-disclosure';
import { useClassifyDisclosure } from './useClassifyDisclosure';
import { useConfirmDisclosure } from './useConfirmDisclosure';

interface UseDisclosureManagementArgs {
  orgId: string;
  projects: PastProject[];
}

/**
 * Inline disclosure management for the past-performance cards. Replaces the
 * standalone review table: the manager toggles "management mode" on, edits each
 * card's disclosure select, then saves one card or all changed cards at once.
 *
 * Saving is the only path that flips a row to confirmed (trusted). "Save all"
 * commits only the rows the reviewer actually changed — untouched rows stay
 * fail-closed until explicitly reviewed.
 */
export const useDisclosureManagement = ({ orgId, projects }: UseDisclosureManagementArgs) => {
  const classify = useClassifyDisclosure();
  const confirm = useConfirmDisclosure();
  const { toast } = useToast();

  const [isActive, setIsActive] = useState(false);
  // projectId -> the reviewer's chosen level (only present once they've touched it).
  const [edits, setEdits] = useState<Record<string, DisclosureLevel>>({});
  // Which card is mid-save (per-card spinner). '__all__' marks a save-all pass.
  const [savingId, setSavingId] = useState<string | null>(null);

  // Revalidate EVERY `past-projects` SWR entry so confirmed changes are reflected
  // immediately in any mounted list, not served stale after navigation.
  const revalidatePastProjects = useCallback(
    () =>
      globalMutate(
        (key) => Array.isArray(key) && key[0] === 'past-projects',
        undefined,
        { revalidate: true },
      ),
    [],
  );

  const projectsById = useMemo(() => {
    const map: Record<string, PastProject> = {};
    for (const p of projects) map[p.projectId] = p;
    return map;
  }, [projects]);

  // The level a card currently shows: the reviewer's edit if present, else the
  // pending (confirmed value, or AI proposal for unconfirmed rows).
  const getLevel = useCallback(
    (project: PastProject): DisclosureLevel => edits[project.projectId] ?? getPendingDisclosure(project),
    [edits],
  );

  // A card is dirty when the reviewer moved it off its pending value.
  const isDirty = useCallback(
    (project: PastProject): boolean =>
      project.projectId in edits && edits[project.projectId] !== getPendingDisclosure(project),
    [edits],
  );

  const dirtyIds = useMemo(
    () => projects.filter((p) => isDirty(p)).map((p) => p.projectId),
    [projects, isDirty],
  );

  const setLevel = useCallback((projectId: string, level: DisclosureLevel) => {
    setEdits((prev) => ({ ...prev, [projectId]: level }));
  }, []);

  const enter = useCallback(() => setIsActive(true), []);
  const exit = useCallback(() => {
    setIsActive(false);
    setEdits({});
  }, []);

  // Set every card to a chosen level (drives "Mark all as…"). Marks them dirty
  // where the value actually differs, so the next "Save all" sweeps them in.
  const markAllAs = useCallback(
    (level: DisclosureLevel) => {
      setEdits((prev) => {
        const next = { ...prev };
        for (const p of projects) next[p.projectId] = level;
        return next;
      });
    },
    [projects],
  );

  const rowFor = useCallback(
    (project: PastProject): ConfirmDisclosureRow => ({
      projectId: project.projectId,
      disclosure: getLevel(project),
      // Preserve the existing note — the confirm endpoint overwrites it, and the
      // cards have no note editor, so re-send what's stored.
      disclosureContactNote: project.disclosureContactNote ?? null,
    }),
    [getLevel],
  );

  const commit = useCallback(
    async (rows: ConfirmDisclosureRow[], savingKey: string, clearIds: string[]) => {
      if (!rows.length) return;
      setSavingId(savingKey);
      try {
        const { confirmed } = await confirm.trigger({ orgId, rows });
        toast({ title: 'Disclosure saved', description: `${confirmed} project(s) updated.` });
        await revalidatePastProjects();
        setEdits((prev) => {
          const next = { ...prev };
          for (const id of clearIds) delete next[id];
          return next;
        });
      } catch (err) {
        toast({
          title: 'Save failed',
          description: (err as Error).message,
          variant: 'destructive',
        });
      } finally {
        setSavingId(null);
      }
    },
    [orgId, confirm, toast, revalidatePastProjects],
  );

  const saveOne = useCallback(
    (project: PastProject) => commit([rowFor(project)], project.projectId, [project.projectId]),
    [commit, rowFor],
  );

  const saveAll = useCallback(() => {
    const dirty = dirtyIds.map((id) => projectsById[id]).filter(Boolean);
    return commit(dirty.map(rowFor), '__all__', dirtyIds);
  }, [commit, dirtyIds, projectsById, rowFor]);

  const handleClassifyAll = useCallback(async () => {
    try {
      const { classified, failed } = await classify.trigger({ orgId, force: false });
      toast({
        title: 'Classification complete',
        description: `${classified} proposed${failed.length ? `, ${failed.length} failed` : ''}.`,
      });
      await revalidatePastProjects();
      setEdits({});
    } catch (err) {
      toast({
        title: 'Classification failed',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  }, [classify, orgId, toast, revalidatePastProjects]);

  return {
    isActive,
    enter,
    exit,
    getLevel,
    setLevel,
    isDirty,
    dirtyCount: dirtyIds.length,
    markAllAs,
    saveOne,
    saveAll,
    isSaving: savingId !== null,
    savingId,
    classifyAll: handleClassifyAll,
    isClassifying: classify.isLoading,
  };
};

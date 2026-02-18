/**
 * Re-export ProjectItem from shared package as Project for convenience.
 * This resolves the @/types/project import used across the codebase.
 */
import type { ProjectItem, CreateProjectDTO, UpdateProjectDTO } from '@auto-rfp/core';

export type Project = ProjectItem;
export type { ProjectItem, CreateProjectDTO, UpdateProjectDTO };

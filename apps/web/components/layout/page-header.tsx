'use client';

import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Page title */
  title: string;
  /** Optional subtitle/description */
  description?: string;
  /** Action buttons / search / filters rendered on the right side */
  actions?: ReactNode;
  /** Additional className for the container */
  className?: string;
}

/**
 * Unified page header component.
 * Provides consistent title, description, and action layout across all pages.
 *
 * Usage:
 * ```tsx
 * <PageHeader
 *   title="Projects"
 *   description="Manage your RFP projects"
 *   actions={
 *     <>
 *       <PageSearch value={search} onChange={setSearch} placeholder="Search projects..." />
 *       <Button><PlusCircle /> New Project</Button>
 *     </>
 *   }
 * />
 * ```
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={`flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-6 ${className ?? ''}`}>
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-3 mt-3 sm:mt-0">{actions}</div>}
    </div>
  );
}

'use client';

import React, { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { getCurrentUser, signOut } from 'aws-amplify/auth';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Building2, ChevronRight, HelpCircle, LogOut } from 'lucide-react';
import { useCurrentOrganization } from '@/context/organization-context';
import { useProjectContext } from '@/context/project-context';
import { useAuth } from '@/components/AuthProvider';
import { OrganizationSwitcher } from '@/components/OrganizationSwitcher';
import { useOpportunity } from '@/lib/hooks/use-opportunities';
import { useProfile } from '@/lib/hooks/use-profile';

// ─── Types ───

interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: React.ReactNode;
  isActive?: boolean;
}

// ─── Constants ───

const ROUTE_LABELS: Record<string, string> = {
  projects: 'Projects',
  'past-performance': 'Past Performance',
  team: 'Team',
  settings: 'Settings',
  'content-library': 'Content Library',
  opportunities: 'Opportunities',
  brief: 'Executive Brief',
  questions: 'Questions',
  documents: 'Solicitation Documents',
  dashboard: 'Dashboard',
  'knowledge-base': 'Knowledge Base',
  deadlines: 'Deadlines',
  templates: 'Templates',
  new: 'New',
  edit: 'Edit',
};

const HIDDEN_PATHS = new Set(['/', '/signup']);
const UUID_REGEX = /^[0-9a-f-]{36}$/i;

// ─── Custom Hooks ───


function useRouteIds(pathname: string) {
  return useMemo(() => {
    const oppMatch = pathname.match(/\/projects\/([^/]+)\/opportunities\/([^/]+)/);
    return {
      projectId: oppMatch?.[1] ?? null,
      opportunityId: oppMatch?.[2] ?? null,
    };
  }, [pathname]);
}

// ─── Breadcrumb Builder ───

function useBreadcrumbs(
  pathname: string,
  orgName: string | undefined,
  orgId: string | undefined,
  projectName: string | undefined,
  opportunityTitle: string | undefined,
): BreadcrumbItem[] {
  return useMemo(() => {
    if (HIDDEN_PATHS.has(pathname)) return [];

    const bc: BreadcrumbItem[] = [];

    if (pathname === '/organizations') {
      return [{ label: 'Organizations', href: '/organizations', icon: <Building2 className="h-4 w-4" />, isActive: true }];
    }

    if (!orgId || !orgName) return bc;

    bc.push({
      label: orgName,
      href: `/organizations/${orgId}`,
      icon: <Building2 className="h-4 w-4" />,
    });

    const orgBasePath = `/organizations/${orgId}`;
    const segments = pathname.replace(orgBasePath, '').split('/').filter(Boolean);
    let currentPath = orgBasePath;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      currentPath += `/${segment}`;
      const isLast = i === segments.length - 1;
      const prevSegment = segments[i - 1];

      if (ROUTE_LABELS[segment]) {
        bc.push({ label: ROUTE_LABELS[segment], href: currentPath, isActive: isLast });
      } else if (UUID_REGEX.test(segment)) {
        if (prevSegment === 'projects' && projectName) {
          bc.push({ label: projectName, href: currentPath, isActive: isLast });
        } else if (prevSegment === 'opportunities') {
          bc.push({ label: opportunityTitle || 'Opportunity', href: currentPath, isActive: isLast });
        }
        // Skip other UUIDs silently
      } else {
        bc.push({
          label: segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' '),
          href: currentPath,
          isActive: isLast,
        });
      }
    }

    return bc;
  }, [pathname, orgName, orgId, projectName, opportunityTitle]);
}

// ─── Sub-components ───

function HeaderSkeleton() {
  return (
    <div className="border-b bg-background">
      <header className="bg-background">
        <div className="container mx-auto flex h-12 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="h-6 w-32 animate-pulse bg-muted rounded" />
            <div className="h-4 w-48 animate-pulse bg-muted rounded hidden md:block" />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-6 w-16 animate-pulse bg-muted rounded" />
            <div className="h-6 w-6 animate-pulse bg-muted rounded-full" />
          </div>
        </div>
      </header>
    </div>
  );
}

function BreadcrumbNav({ items, showLeadingChevron }: { items: BreadcrumbItem[]; showLeadingChevron: boolean }) {
  if (items.length === 0) return null;

  return (
    <nav className="flex items-center gap-1 text-sm">
      {showLeadingChevron && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      {items.map((crumb, index) => (
        <React.Fragment key={`${crumb.label}-${index}`}>
          {crumb.href ? (
            <Link
              href={crumb.href}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted transition-colors ${
                crumb.isActive ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {crumb.icon}
              {crumb.label}
            </Link>
          ) : (
            <span className={`flex items-center gap-1.5 px-2 py-1 ${crumb.isActive ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
              {crumb.icon}
              {crumb.label}
            </span>
          )}
          {index < items.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        </React.Fragment>
      ))}
    </nav>
  );
}

interface UserMenuProps {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  email?: string | null;
}

function UserMenu({ firstName, lastName, displayName: customDisplayName, email }: UserMenuProps) {
  const [isPending, startTransition] = useTransition();

  // Same display name logic as sidebar user-section.tsx
  const displayName =
    customDisplayName ||
    (firstName && lastName ? `${firstName} ${lastName}` : firstName) ||
    email?.split('@')[0] ||
    'User';

  const initials = (() => {
    if (firstName && lastName) {
      return `${firstName[0]}${lastName[0]}`.toUpperCase();
    }
    return displayName.slice(0, 2).toUpperCase();
  })();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="flex items-center gap-2">
          <Avatar className="h-6 w-6">
            <AvatarFallback className="bg-purple-600 text-white text-xs">{initials}</AvatarFallback>
          </Avatar>
          <span className="text-sm">{displayName}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-purple-600 text-white text-xs">{initials}</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{displayName}</span>
              {email && <span className="truncate text-xs text-muted-foreground">{email}</span>}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive cursor-pointer"
          disabled={isPending}
          onClick={() => startTransition(async () => await signOut({ global: true }))}
        >
          <LogOut className="mr-2 h-4 w-4" />
          <span>{isPending ? 'Logging out...' : 'Log out'}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─── Main Component ───

export function GlobalHeader() {
  const pathname = usePathname();
  const { currentOrganization } = useCurrentOrganization();
  const { currentProject } = useProjectContext();
  const { orgId: authOrgId, role, isAuthed, email: authEmail } = useAuth();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Only show super admin UI when auth is resolved and user has no role (true super admin)
  const isSuperAdmin = isAuthed && !role;
  const isAuthResolved = isAuthed && (!!authOrgId || !role);
  const isHidden = HIDDEN_PATHS.has(pathname);

  // Extract opportunity info from URL for breadcrumb resolution
  const { projectId: routeProjectId, opportunityId: routeOppId } = useRouteIds(pathname);
  const { data: opportunityData } = useOpportunity(routeProjectId, routeOppId, currentOrganization?.id);

  const { profile } = useProfile();

  const breadcrumbs = useBreadcrumbs(
    pathname,
    currentOrganization?.name,
    currentOrganization?.id,
    currentProject?.name,
    (opportunityData as any)?.title,
  );

  // Early returns
  if (isHidden) return null;
  if (!mounted) return <HeaderSkeleton />;

  return (
    <div className="border-b bg-background">
      <header className="bg-background">
        <div className="container mx-auto flex h-12 items-center justify-between px-4">
          {/* Left: Logo + Breadcrumbs */}
          <div className="flex items-center gap-3">
            {isSuperAdmin && (
              <Link href="/organizations" className="flex items-center gap-2">
                <Image src="/logo.png" alt="AutoRFP" width={75} height={75} />
                <span className="font-semibold text-lg">System Admin</span>
              </Link>
            )}
            <BreadcrumbNav items={breadcrumbs} showLeadingChevron={isSuperAdmin} />
          </div>

          {/* Right: Help + Org Switcher + User Menu */}
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/help" className="flex items-center gap-1.5">
                <HelpCircle className="h-4 w-4" />
                <span className="text-sm">Help</span>
              </Link>
            </Button>
            {isAuthResolved && !authOrgId && <OrganizationSwitcher />}
            <UserMenu
              firstName={profile?.firstName}
              lastName={profile?.lastName}
              displayName={profile?.displayName}
              email={profile?.email || authEmail}
            />
          </div>
        </div>
      </header>
    </div>
  );
}
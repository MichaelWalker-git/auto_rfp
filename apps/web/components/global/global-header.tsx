'use client';

import React, { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { signOut } from 'aws-amplify/auth';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem as BreadcrumbItemUI,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Building2, ChevronRight, HelpCircle, LogOut, Pencil } from 'lucide-react';
import { NotificationBell } from '@/features/notifications';
import { ProfileEditDialog } from '@/components/profile-edit-dialog';
import { useCurrentOrganization } from '@/context/organization-context';
import { useProjectContext } from '@/context/project-context';
import { useAuth } from '@/components/AuthProvider';
import { OrganizationSwitcher } from '@/components/OrganizationSwitcher';
import { useOpportunity } from '@/lib/hooks/use-opportunities';
import { useKnowledgeBase } from '@/lib/hooks/use-knowledgebase';
import { useProfile } from '@/lib/hooks/use-profile';
import { useUsersList } from '@/lib/hooks/use-user';
import { useRFPDocumentPolling } from '@/lib/hooks/use-rfp-documents';

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
  'content-library': 'Q&A Library',
  'stale-report': 'Stale Report',
  'semantic-search': 'Semantic Search Tester',
  opportunities: 'Opportunities',
  brief: 'Executive Briefs',
  questions: 'Questions',
  documents: 'Solicitation Documents',
  dashboard: 'Dashboard',
  'knowledge-base': 'Org Documents',
  deadlines: 'Deadlines',
  templates: 'Templates',
  new: 'New',
  edit: 'Edit',
};

// Helper to truncate text
function truncateText(text: string, maxLength: number = 20): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

const HIDDEN_PATHS = new Set(['/', '/signup']);
const UUID_REGEX = /^[0-9a-f-]{36}$/i;

// ─── Custom Hooks ───


function useRouteIds(pathname: string) {
  return useMemo(() => {
    const oppMatch = pathname.match(/\/projects\/([^/]+)\/opportunities\/([^/]+)/);
    const kbMatch = pathname.match(/\/knowledge-base\/([^/]+)/);
    const teamMemberMatch = pathname.match(/\/team\/([^/]+)/);
    const rfpDocMatch = pathname.match(/\/opportunities\/[^/]+\/rfp-documents\/([^/]+)/);
    return {
      projectId: oppMatch?.[1] ?? null,
      opportunityId: oppMatch?.[2] ?? null,
      kbId: kbMatch?.[1] && UUID_REGEX.test(kbMatch[1]) ? kbMatch[1] : null,
      userId: teamMemberMatch?.[1] && UUID_REGEX.test(teamMemberMatch[1]) ? teamMemberMatch[1] : null,
      rfpDocumentId: rfpDocMatch?.[1] ?? null,
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
  kbName: string | undefined,
  userName: string | undefined,
  rfpDocumentName: string | undefined,
): BreadcrumbItem[] {
  return useMemo(() => {
    if (HIDDEN_PATHS.has(pathname)) return [];

    const bc: BreadcrumbItem[] = [];

    if (pathname === '/organizations') {
      return [{
        label: 'Organizations',
        href: '/organizations',
        icon: <Building2 className="h-4 w-4"/>,
        isActive: true
      }];
    }

    if (!orgId || !orgName) return bc;

    bc.push({
      label: orgName,
      href: `/organizations/${orgId}`,
      icon: <Building2 className="h-4 w-4"/>,
    });

    const orgBasePath = `/organizations/${orgId}`;
    const segments = pathname.replace(orgBasePath, '').split('/').filter(Boolean);
    let currentPath = orgBasePath;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      currentPath += `/${segment}`;
      const isLast = i === segments.length - 1;
      const prevSegment = segments[i - 1];
      const nextSegment = segments[i + 1];

      // ── RFP document route handling ──
      // Path: .../opportunities/{oppId}/rfp-documents/{docId}/edit
      // Show: Opportunities / {oppName} / {docName}  (skip rfp-documents segment and edit segment)
      if (segment === 'rfp-documents') {
        // Skip this segment entirely — document name will appear as next crumb
        continue;
      }

      // Skip "edit" segment when inside rfp-documents route
      if (segment === 'edit' && segments[i - 2] === 'rfp-documents') {
        continue;
      }

      // UUID under rfp-documents → show document name as active crumb
      if (UUID_REGEX.test(segment) && prevSegment === 'rfp-documents') {
        bc.push({ label: rfpDocumentName || 'Document', isActive: true });
        continue;
      }

      // Inside a KB detail route, skip sub-page labels and let the kbName breadcrumb be the active one
      const isKbSubPage = segment === 'content-library' || segment === 'access';
      const isInsideKb = prevSegment && UUID_REGEX.test(prevSegment) && segments[i - 2] === 'knowledge-base';

      if (isKbSubPage && isInsideKb) {
        // Replace the previous kbName breadcrumb href with the sub-page path and mark active
        const prev = bc[bc.length - 1];
        if (prev) {
          prev.href = currentPath;
          prev.isActive = isLast;
        }
      } else if (ROUTE_LABELS[segment]) {
        bc.push({ label: ROUTE_LABELS[segment], href: currentPath, isActive: isLast });
      } else if (UUID_REGEX.test(segment)) {
        if (prevSegment === 'projects' && projectName) {
          bc.push({ label: projectName, href: currentPath, isActive: isLast });
        } else if (prevSegment === 'opportunities') {
          bc.push({ label: opportunityTitle || 'Opportunity', href: currentPath, isActive: isLast });
        } else if (prevSegment === 'knowledge-base') {
          bc.push({ label: kbName || 'Document Folder', href: currentPath, isActive: isLast });
        } else if (prevSegment === 'team') {
          bc.push({ label: userName || 'Team Member', href: currentPath, isActive: isLast });
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
  }, [pathname, orgName, orgId, projectName, opportunityTitle, kbName, rfpDocumentName]);
}

// ─── Sub-components ───

function HeaderSkeleton() {
  return (
    <div className="border-b bg-background">
      <header className="bg-background">
        <div className="container mx-auto flex h-12 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="h-6 w-32 animate-pulse bg-muted rounded"/>
            <div className="h-4 w-48 animate-pulse bg-muted rounded hidden md:block"/>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-6 w-16 animate-pulse bg-muted rounded"/>
            <div className="h-6 w-6 animate-pulse bg-muted rounded-full"/>
          </div>
        </div>
      </header>
    </div>
  );
}

/**
 * Responsive breadcrumb navigation using shadcn/ui Breadcrumb components.
 *
 * When there are more than 2 items, middle items are always collapsed into
 * a dropdown menu accessible via an ellipsis button. This keeps the breadcrumb
 * compact on all screen sizes.
 *
 * Layout:
 * - ≤ 2 items: show all items inline
 * - > 2 items: [first] / [...] / [last] (middle items in dropdown)
 */
const ITEMS_BEFORE_COLLAPSE = 1; // Show first N items before ellipsis
const ITEMS_AFTER_COLLAPSE = 1;  // Show last N items after ellipsis

function BreadcrumbNav({ items, showLeadingChevron }: { items: BreadcrumbItem[]; showLeadingChevron: boolean }) {
  if (items.length === 0) return null;

  const shouldCollapse = items.length > ITEMS_BEFORE_COLLAPSE + ITEMS_AFTER_COLLAPSE;
  const visibleBefore = items.slice(0, ITEMS_BEFORE_COLLAPSE);
  const collapsedItems = shouldCollapse
    ? items.slice(ITEMS_BEFORE_COLLAPSE, items.length - ITEMS_AFTER_COLLAPSE)
    : [];
  const visibleAfter = shouldCollapse
    ? items.slice(items.length - ITEMS_AFTER_COLLAPSE)
    : items.slice(ITEMS_BEFORE_COLLAPSE);

  const renderCrumb = (crumb: BreadcrumbItem, index: number) => {
    const displayLabel = truncateText(crumb.label);
    const isTruncated = displayLabel !== crumb.label;

    if (crumb.isActive && !crumb.href) {
      return (
        <BreadcrumbPage
          title={isTruncated ? crumb.label : undefined}
          className="flex items-center gap-1.5 max-w-[180px] sm:max-w-none"
        >
          {crumb.icon}
          <span className="truncate">{displayLabel}</span>
        </BreadcrumbPage>
      );
    }

    return (
      <BreadcrumbLink asChild>
        <Link
          href={crumb.href ?? '#'}
          title={isTruncated ? crumb.label : undefined}
          className="flex items-center gap-1.5 max-w-[180px] sm:max-w-none"
        >
          {crumb.icon}
          <span className="truncate">{displayLabel}</span>
        </Link>
      </BreadcrumbLink>
    );
  };

  return (
    <div className="flex items-center gap-1">
      {showLeadingChevron && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
      <Breadcrumb>
        <BreadcrumbList className="flex-nowrap">
          {/* Always-visible first items */}
          {visibleBefore.map((crumb, i) => (
            <React.Fragment key={`before-${crumb.label}-${i}`}>
              <BreadcrumbItemUI className="hidden sm:inline-flex">
                {renderCrumb(crumb, i)}
              </BreadcrumbItemUI>
              {/* On mobile, show only the icon for the first item (org) */}
              <BreadcrumbItemUI className="inline-flex sm:hidden">
                {crumb.icon ? (
                  crumb.href ? (
                    <BreadcrumbLink asChild>
                      <Link href={crumb.href} title={crumb.label}>
                        {crumb.icon}
                      </Link>
                    </BreadcrumbLink>
                  ) : (
                    <BreadcrumbPage title={crumb.label}>
                      {crumb.icon}
                    </BreadcrumbPage>
                  )
                ) : (
                  renderCrumb(crumb, i)
                )}
              </BreadcrumbItemUI>
              {(visibleAfter.length > 0 || collapsedItems.length > 0) && (
                <BreadcrumbSeparator />
              )}
            </React.Fragment>
          ))}

          {/* Collapsed middle items — always shown as ellipsis dropdown */}
          {collapsedItems.length > 0 && (
            <>
              <BreadcrumbItemUI>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex items-center justify-center" aria-label="Show more breadcrumbs">
                      <BreadcrumbEllipsis className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {collapsedItems.map((crumb, i) => (
                      <DropdownMenuItem key={`collapsed-${crumb.label}-${i}`} asChild>
                        {crumb.href ? (
                          <Link href={crumb.href} className="flex items-center gap-2">
                            {crumb.icon}
                            {crumb.label}
                          </Link>
                        ) : (
                          <span className="flex items-center gap-2">
                            {crumb.icon}
                            {crumb.label}
                          </span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </BreadcrumbItemUI>
              <BreadcrumbSeparator />
            </>
          )}

          {/* Always-visible last items */}
          {visibleAfter.map((crumb, i) => (
            <React.Fragment key={`after-${crumb.label}-${i}`}>
              <BreadcrumbItemUI>
                {renderCrumb(crumb, items.length - ITEMS_AFTER_COLLAPSE + i)}
              </BreadcrumbItemUI>
              {i < visibleAfter.length - 1 && <BreadcrumbSeparator />}
            </React.Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
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
  const [isProfileOpen, setIsProfileOpen] = useState(false);

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
        <DropdownMenuSeparator/>
        <DropdownMenuItem onClick={() => setIsProfileOpen(true)}>
          <Pencil className="mr-2 h-4 w-4"/>
          <span>Edit Profile</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator/>
        <DropdownMenuItem
          className="text-destructive cursor-pointer"
          disabled={isPending}
          onClick={() => startTransition(async () => await signOut({ global: true }))}
        >
          <LogOut className="mr-2 h-4 w-4"/>
          <span>{isPending ? 'Logging out...' : 'Log out'}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
      <ProfileEditDialog open={isProfileOpen} onOpenChange={setIsProfileOpen} />
    </DropdownMenu>
  );
}

// ─── Main Component ───

export function GlobalHeader() {
  const pathname = usePathname();
  const { currentOrganization, organizations } = useCurrentOrganization();
  const { currentProject } = useProjectContext();
  const { orgId: authOrgId, role, isAuthed, email: authEmail } = useAuth();

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const showOrgNav = organizations.length > 1;
  const isAuthResolved = isAuthed && (!!authOrgId || !role);
  const isHidden = HIDDEN_PATHS.has(pathname);

  // Extract route IDs for breadcrumb resolution
  const { projectId: routeProjectId, opportunityId: routeOppId, kbId: routeKbId, userId: routeUserId, rfpDocumentId: routeRfpDocId } = useRouteIds(pathname);
  const { data: opportunityData } = useOpportunity(routeProjectId, routeOppId, currentOrganization?.id);
  const { data: kbData } = useKnowledgeBase(routeKbId, currentOrganization?.id ?? null);

  // Fetch RFP document name for breadcrumb when on rfp-documents route
  const { document: rfpDocumentData } = useRFPDocumentPolling(
    routeRfpDocId ? routeProjectId : null,
    routeRfpDocId ? routeOppId : null,
    routeRfpDocId,
    routeRfpDocId ? (currentOrganization?.id ?? null) : null,
  );

  const { profile } = useProfile();

  // Fetch user data for team member breadcrumb
  const { data: usersData } = useUsersList(currentOrganization?.id || '', { limit: 200 });
  const teamMember = useMemo(
    () => routeUserId ? usersData?.items?.find((u: any) => u.userId === routeUserId) : null,
    [routeUserId, usersData],
  );
  const teamMemberName = teamMember 
    ? (teamMember.displayName || [teamMember.firstName, teamMember.lastName].filter(Boolean).join(' ') || teamMember.email)
    : undefined;

  const { breadcrumbSuffix } = useProjectContext();

  const baseBreadcrumbs = useBreadcrumbs(
    pathname,
    currentOrganization?.name,
    currentOrganization?.id,
    currentProject?.name,
    (opportunityData as any)?.title,
    kbData?.name,
    teamMemberName,
    rfpDocumentData?.name,
  );

  // Append the dynamic breadcrumb suffix (e.g. selected question text) if present
  const breadcrumbs = breadcrumbSuffix
    ? [
        ...baseBreadcrumbs.map((b) => ({ ...b, isActive: false })),
        { label: breadcrumbSuffix, isActive: true },
      ]
    : baseBreadcrumbs;

  // Early returns
  if (isHidden) return null;
  if (!mounted) return <HeaderSkeleton/>;

  return (
    <div className="border-b bg-background">
      <header className="bg-background">
        <div className="container mx-auto flex h-12 items-center justify-between px-4">
          {/* Left: Logo + Breadcrumbs */}
          <div className="flex items-center gap-3">
            {showOrgNav && (
              <Link href="/organizations" className="flex items-center gap-2">
                <span className="font-semibold text-lg">
                  {'Organizations'}
                </span>
              </Link>
            )}
            <BreadcrumbNav items={breadcrumbs} showLeadingChevron={showOrgNav}/>
          </div>

          {/* Right: Help + Org Switcher + User Menu */}
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/help" className="flex items-center gap-1.5">
                <HelpCircle className="h-4 w-4"/>
                <span className="text-sm">Help</span>
              </Link>
            </Button>
            {isAuthResolved && (showOrgNav || !authOrgId) && <OrganizationSwitcher/>}
            {currentOrganization?.id && <NotificationBell orgId={currentOrganization.id} />}
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
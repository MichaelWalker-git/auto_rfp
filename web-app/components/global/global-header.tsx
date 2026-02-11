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
import { useAuth } from '@/components/AuthProvider';
import { OrganizationSwitcher } from '@/components/OrganizationSwitcher';

interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: React.ReactNode;
  active?: boolean;
}

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

type IdTokenPayload = Record<string, unknown> & {
  email?: string;
  preferred_username?: string;
  'cognito:username'?: string;
};

export function GlobalHeader() {
  const pathname = usePathname();
  const { currentOrganization } = useCurrentOrganization();

  const [mounted, setMounted] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const { getIdToken, orgId, role } = useAuth();
  const isSuperAdmin = !role;

  // derived values (NOT hooks)
  const hideHeader = pathname === '/' || pathname === '/signup';

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;

    let cancelled = false;

    (async () => {
      try {
        const token = await getIdToken();
        const payload = token?.payload as IdTokenPayload;
        const emailFromToken =
          payload?.email ??
          payload?.preferred_username ??
          payload?.['cognito:username'] ??
          null;

        if (emailFromToken) {
          if (!cancelled) setUserEmail(emailFromToken);
          return;
        }

        const user = await getCurrentUser();
        if (!cancelled) setUserEmail(user?.username ?? null);
      } catch {
        if (!cancelled) setUserEmail(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mounted]);

  const breadcrumbs: BreadcrumbItem[] = useMemo(() => {
    if (!mounted || hideHeader) return [];

    const bc: BreadcrumbItem[] = [];

    if (pathname === '/organizations') {
      bc.push({
        label: 'Organizations',
        href: '/organizations',
        icon: <Building2 className="h-4 w-4"/>,
        active: true,
      });
      return bc;
    }

    if (currentOrganization) {
      bc.push({
        label: currentOrganization.name,
        href: `/organizations/${currentOrganization.id}`,
        icon: <Building2 className="h-4 w-4"/>,
      });

      // Parse the pathname to add more breadcrumbs
      const orgBasePath = `/organizations/${currentOrganization.id}`;
      const relativePath = pathname.replace(orgBasePath, '');
      const segments = relativePath.split('/').filter(Boolean);

      // Map of known routes to labels
      const routeLabels: Record<string, string> = {
        'projects': 'Projects',
        'past-performance': 'Past Performance',
        'team': 'Team',
        'settings': 'Settings',
        'content-library': 'Content Library',
        'opportunities': 'Opportunities',
        'proposals': 'Proposals',
        'brief': 'Executive Brief',
        'new': 'New',
        'edit': 'Edit',
      };

      let currentPath = orgBasePath;
      
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        currentPath += `/${segment}`;
        
        // Check if this is a known route
        if (routeLabels[segment]) {
          bc.push({
            label: routeLabels[segment],
            href: currentPath,
            active: i === segments.length - 1,
          });
        } else if (segment.match(/^[0-9a-f-]{36}$/i)) {
          // This looks like a UUID - skip it or show as ID
          // We could fetch the actual name here, but for now just skip
          continue;
        } else {
          // Unknown segment - show as-is with title case
          bc.push({
            label: segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' '),
            href: currentPath,
            active: i === segments.length - 1,
          });
        }
      }
    }

    return bc;
  }, [mounted, hideHeader, pathname, currentOrganization]);

  if (hideHeader) return null;
  if (!mounted) return <HeaderSkeleton/>;

  const displayName = userEmail?.split('@')[0] || 'User';
  const avatarLetter = userEmail ? userEmail.charAt(0).toUpperCase() : 'U';

  return (
    <div className="border-b bg-background">
      <header className="bg-background">
        <div className="container mx-auto flex h-12 items-center justify-between px-4">
          <div className="flex items-center gap-3">
            {isSuperAdmin && (
              <Link href="/organizations" className="flex items-center gap-2">
                <Image src="/logo.png" alt="AutoRFP" width={75} height={75}/>
                <span className="font-semibold text-lg">Auto RFP</span>
              </Link>
            )}

            {breadcrumbs.length > 0 && (
              <nav className="flex items-center gap-1 text-sm">
                {isSuperAdmin && <ChevronRight className="h-4 w-4 text-muted-foreground"/>}
                {breadcrumbs.map((crumb, index) => (
                  <React.Fragment key={`${crumb.label}-${index}`}>
                    {crumb.href ? (
                      <Link
                        href={crumb.href}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted transition-colors ${
                          crumb.active
                            ? 'text-foreground font-medium'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {crumb.icon}
                        {crumb.label}
                      </Link>
                    ) : (
                      <span
                        className={`flex items-center gap-1.5 px-2 py-1 ${
                          crumb.active ? 'text-foreground font-medium' : 'text-muted-foreground'
                        }`}
                      >
                        {crumb.icon}
                        {crumb.label}
                      </span>
                    )}
                    {index < breadcrumbs.length - 1 && (
                      <ChevronRight className="h-3 w-3 text-muted-foreground"/>
                    )}
                  </React.Fragment>
                ))}
              </nav>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/help" className="flex items-center gap-1.5">
                <HelpCircle className="h-4 w-4"/>
                <span className="text-sm">Help</span>
              </Link>
            </Button>

            {!orgId && <OrganizationSwitcher/>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="flex items-center gap-2">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-xs">{avatarLetter}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{displayName}</span>
                </Button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">My Account</p>
                    {userEmail && (
                      <p className="text-xs leading-none text-muted-foreground">{userEmail}</p>
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator/>
                <DropdownMenuItem
                  className="text-destructive cursor-pointer"
                  disabled={isPending}
                  onClick={() => {
                    startTransition(async () => await signOut({ global: true }));
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4"/>
                  <span>{isPending ? 'Logging out...' : 'Log out'}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>
    </div>
  );
}
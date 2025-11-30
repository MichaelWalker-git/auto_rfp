'use client';
import { getCurrentUser, signOut } from 'aws-amplify/auth';

import React, { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { usePathname, useParams, useRouter } from 'next/navigation';
import { ChevronRight, LogOut, Settings, Users, FileText, HelpCircle, Building2 } from 'lucide-react';
import Image from 'next/image';
import { useTransition } from 'react';
import { useOrganization } from '@/context/organization-context';

interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: React.ReactNode;
  active?: boolean;
}

function GlobalHeaderContent() {
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const { currentOrganization, currentProject } = useOrganization();
  
  // Fetch user email on component mount
  useEffect(() => {
    const fetchUserEmail = async () => {
      // const user = await getCurrentUser();
      // setUserEmail(user.username);
    };
    fetchUserEmail();
  }, []);

  // Build dynamic breadcrumbs based on current route
  const buildBreadcrumbs = (): BreadcrumbItem[] => {
    const breadcrumbs: BreadcrumbItem[] = [];

    // Home/Organizations
    if (pathname === '/organizations') {
      breadcrumbs.push({
        label: 'Organizations',
        href: '/organizations',
        icon: <Building2 className="h-4 w-4" />,
        active: true
      });
      return breadcrumbs;
    }

    // Organization context
    if (currentOrganization) {
      breadcrumbs.push({
        label: currentOrganization.name,
        href: `/organizations/${currentOrganization.id}`,
        icon: <Building2 className="h-4 w-4" />
      });

      // Project context
      if (currentProject) {
        breadcrumbs.push({
          label: currentProject.name,
          href: `/projects/${currentProject.id}`
        });

        // Project sub-pages
        if (pathname.includes('/documents')) {
          breadcrumbs.push({
            label: 'Documents',
            href: `/projects/${currentProject.id}/documents`,
            icon: <FileText className="h-4 w-4" />,
            active: true
          });
        } else if (pathname.includes('/questions')) {
          breadcrumbs.push({
            label: 'Questions',
            href: `/projects/${currentProject.id}/questions`,
            icon: <HelpCircle className="h-4 w-4" />,
            active: true
          });
        } else if (pathname.includes('/team')) {
          breadcrumbs.push({
            label: 'Team',
            href: `/projects/${currentProject.id}/team`,
            icon: <Users className="h-4 w-4" />,
            active: true
          });
        } else {
          // Default project page
          breadcrumbs[breadcrumbs.length - 1].active = true;
        }
      } else {
        // Organization sub-pages
        if (pathname.includes('/team')) {
          breadcrumbs.push({
            label: 'Team',
            icon: <Users className="h-4 w-4" />,
            active: true
          });
        } else if (pathname.includes('/settings')) {
          breadcrumbs.push({
            label: 'Settings',
            icon: <Settings className="h-4 w-4" />,
            active: true
          });
        } else if (pathname.includes('/documents')) {
          breadcrumbs.push({
            label: 'Documents',
            icon: <FileText className="h-4 w-4" />,
            active: true
          });
        } else {
          // Default organization page
          breadcrumbs[breadcrumbs.length - 1].active = true;
        }
      }
    }

    return breadcrumbs;
  };

  const breadcrumbs = buildBreadcrumbs();

  // Don't show header on certain pages
  if (pathname === '/' || pathname === '/login' || pathname === '/signup') {
    return null;
  }

  return (
    <div className="border-b bg-background">
      

      {/* Main Header */}
      <header className="bg-background">
        <div className="container mx-auto flex h-12 items-center justify-between px-4">
          {/* Left side - Logo and Breadcrumbs */}
          <div className="flex items-center gap-3">
            <Link href="/organizations" className="flex items-center gap-2">
              <Image src="/llamaindex_logo.jpeg" alt="AutoRFP" width={24} height={24} />
              <span className="font-semibold text-lg">AutoRFP</span>
            </Link>
            
            {/* Breadcrumbs */}
            {breadcrumbs.length > 0 && (
              <nav className="flex items-center gap-1 text-sm">
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                {breadcrumbs.map((crumb, index) => (
                  <React.Fragment key={index}>
                    {crumb.href ? (
                      <Link 
                        href={crumb.href}
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted transition-colors ${
                          crumb.active ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {crumb.icon}
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className={`flex items-center gap-1.5 px-2 py-1 ${
                        crumb.active ? 'text-foreground font-medium' : 'text-muted-foreground'
                      }`}>
                        {crumb.icon}
                        {crumb.label}
                      </span>
                    )}
                    {index < breadcrumbs.length - 1 && (
                      <ChevronRight className="h-3 w-3 text-muted-foreground" />
                    )}
                  </React.Fragment>
                ))}
              </nav>
            )}
          </div>

          {/* Right side - User menu */}
          <div className="flex items-center gap-3">
            {/* Help Link */}
            <Button variant="ghost" size="sm" asChild>
              <Link href="/help" className="flex items-center gap-1.5">
                <HelpCircle className="h-4 w-4" />
                <span className="text-sm">Help</span>
              </Link>
            </Button>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="flex items-center gap-2">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-xs">
                      {userEmail ? userEmail.charAt(0).toUpperCase() : 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{userEmail?.split('@')[0] || 'User'}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">My Account</p>
                    {userEmail && (
                      <p className="text-xs leading-none text-muted-foreground">
                        {userEmail}
                      </p>
                    )}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  className="text-destructive cursor-pointer"
                  onClick={() => {
                    startTransition(async () => {
                      await signOut({
                        global: true
                      })
                    });
                  }}
                  disabled={isPending}
                >
                  <LogOut className="mr-2 h-4 w-4" />
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

export function GlobalHeader() {
  return (
    <Suspense fallback={
      <div className="border-b bg-background">
        <div className="bg-green-100 border-green-200 border-b px-4 py-2">
          <div className="h-6 animate-pulse bg-green-200 rounded w-48"></div>
        </div>
        <header className="bg-background">
          <div className="container mx-auto flex h-12 items-center justify-between px-4">
            <div className="flex items-center gap-3">
              <div className="h-6 w-32 animate-pulse bg-muted rounded"></div>
            </div>
            <div className="flex items-center gap-3">
              <div className="h-6 w-16 animate-pulse bg-muted rounded"></div>
              <div className="h-6 w-6 animate-pulse bg-muted rounded-full"></div>
            </div>
          </div>
        </header>
      </div>
    }>
      <GlobalHeaderContent />
    </Suspense>
  );
} 
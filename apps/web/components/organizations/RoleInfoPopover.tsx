'use client';

import { Info, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import type { UserRole } from '@auto-rfp/core';

interface RoleCapability {
  label: string;
  roles: UserRole[];
}

const CAPABILITY_GROUPS: { group: string; capabilities: RoleCapability[] }[] = [
  {
    group: 'Content',
    capabilities: [
      { label: 'View projects, proposals & documents', roles: ['ADMIN', 'EDITOR', 'MEMBER', 'VIEWER'] },
      { label: 'Create projects & opportunities', roles: ['ADMIN', 'EDITOR', 'MEMBER'] },
      { label: 'Create proposals & documents', roles: ['ADMIN', 'EDITOR', 'MEMBER'] },
      { label: 'Edit projects, proposals & documents', roles: ['ADMIN', 'EDITOR'] },
      { label: 'Delete projects, proposals & documents', roles: ['ADMIN'] },
    ],
  },
  {
    group: 'AI & Knowledge',
    capabilities: [
      { label: 'View knowledge bases & answers', roles: ['ADMIN', 'EDITOR', 'MEMBER', 'VIEWER'] },
      { label: 'Create & generate answers', roles: ['ADMIN', 'EDITOR', 'MEMBER'] },
      { label: 'Manage knowledge bases', roles: ['ADMIN', 'EDITOR'] },
      { label: 'Manage templates', roles: ['ADMIN', 'EDITOR'] },
      { label: 'Manage prompts', roles: ['ADMIN'] },
    ],
  },
  {
    group: 'Collaboration',
    capabilities: [
      { label: 'View presence & activity', roles: ['ADMIN', 'EDITOR', 'MEMBER', 'VIEWER'] },
      { label: 'Comment & assign tasks', roles: ['ADMIN', 'EDITOR'] },
    ],
  },
  {
    group: 'Pricing',
    capabilities: [
      { label: 'View pricing', roles: ['ADMIN', 'EDITOR', 'BILLING'] },
      { label: 'Create & edit pricing', roles: ['ADMIN', 'EDITOR'] },
      { label: 'Calculate pricing', roles: ['ADMIN', 'EDITOR', 'BILLING'] },
    ],
  },
  {
    group: 'Administration',
    capabilities: [
      { label: 'Manage users', roles: ['ADMIN', 'EDITOR'] },
      { label: 'Manage organization settings', roles: ['ADMIN'] },
      { label: 'View audit logs', roles: ['ADMIN'] },
      { label: 'Delete users & resources', roles: ['ADMIN'] },
    ],
  },
];

const ORDERED_ROLES: UserRole[] = ['ADMIN', 'EDITOR', 'MEMBER', 'VIEWER', 'BILLING'];

const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  ADMIN: 'Full access to all features and settings',
  EDITOR: 'Create, edit, and manage content across the platform',
  MEMBER: 'Create content and collaborate with limited management access',
  VIEWER: 'Read-only access to all content',
  BILLING: 'Access to pricing and financial data only',
};

export const RoleInfoPopover = () => {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground hover:text-foreground"
        >
          <Info className="h-3.5 w-3.5" />
          <span className="sr-only">Role permissions info</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[540px] max-h-[70vh] overflow-y-auto p-0">
        <div className="p-4 border-b">
          <h4 className="font-semibold text-sm">Role Permissions</h4>
          <p className="text-xs text-muted-foreground mt-1">
            What each role can do in the platform
          </p>
        </div>

        {/* Role summary badges */}
        <div className="p-4 border-b space-y-2">
          {ORDERED_ROLES.map((role) => (
            <div key={role} className="flex items-start gap-2">
              <Badge variant="outline" className="shrink-0 w-16 justify-center text-xs">
                {role}
              </Badge>
              <span className="text-xs text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</span>
            </div>
          ))}
        </div>

        {/* Capability matrix */}
        <div className="p-4 space-y-4">
          {CAPABILITY_GROUPS.map(({ group, capabilities }) => (
            <div key={group}>
              <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                {group}
              </h5>
              <div className="space-y-1">
                {capabilities.map(({ label, roles }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span className="text-xs flex-1 min-w-0 truncate">{label}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {ORDERED_ROLES.map((role) => (
                        <span
                          key={role}
                          className="w-5 h-5 flex items-center justify-center"
                          title={role}
                        >
                          {roles.includes(role) ? (
                            <Check className="h-3 w-3 text-emerald-600" />
                          ) : (
                            <X className="h-3 w-3 text-muted-foreground/30" />
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Column legend */}
          <div className="flex items-center justify-end gap-1 pt-2 border-t">
            {ORDERED_ROLES.map((role) => (
              <span
                key={role}
                className="w-5 text-center text-[10px] text-muted-foreground font-medium"
                title={role}
              >
                {role.charAt(0)}
              </span>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
};
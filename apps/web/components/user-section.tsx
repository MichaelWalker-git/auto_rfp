"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronsUpDown, LogOut, UserPen } from "lucide-react";
import React, { useState, useTransition } from "react";

import { signOut } from "aws-amplify/auth";
import { useAuth } from "@/components/AuthProvider";
import { useProfile } from "@/lib/hooks/use-profile";
import { ProfileEditDialog } from "@/components/profile-edit-dialog";

export const UserSection: React.FC = () => {
  const [isPending, startTransition] = useTransition();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const { open } = useSidebar();
  const { email } = useAuth();
  const { profile } = useProfile();

  const handleSignOut = () => {
    startTransition(async () => {
      try {
        await signOut({ global: true });
      } catch (error) {
        console.error("Error signing out:", error);
      }
    });
  };

  const displayName =
    profile?.displayName ||
    (profile?.firstName && profile?.lastName
      ? `${profile.firstName} ${profile.lastName}`
      : profile?.firstName) ||
    email?.split("@")[0] ||
    "User";

  const userEmail = email || profile?.email || "";

  const initials = (() => {
    if (profile?.firstName && profile?.lastName) {
      return `${profile.firstName[0]}${profile.lastName[0]}`.toUpperCase();
    }
    return displayName.slice(0, 2).toUpperCase();
  })();

  return (
    <>
      <Tooltip delayDuration={25}>
        <TooltipTrigger asChild>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size={open ? "lg" : "default"}
                    className="overflow-visible"
                    tooltip={displayName}
                  >
                    <Avatar className={open ? "size-8" : "size-6"}>
                      <AvatarFallback className="bg-purple-600 text-white">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="gap-0.5 overflow-hidden text-xs group-data-[collapsible=icon]:hidden">
                      <div className="truncate leading-none text-foreground">
                        <span>{displayName}</span>
                      </div>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4 group-data-[collapsible=icon]:hidden" />
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                  side="right"
                  align="end"
                  sideOffset={4}
                >
                  <DropdownMenuLabel className="p-0 font-normal">
                    <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                      <Avatar className="size-8">
                        <AvatarFallback className="bg-purple-600 text-white">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <div className="grid flex-1 text-left text-sm leading-tight">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="truncate font-semibold">
                              {displayName}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{displayName}</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="truncate text-xs text-muted-foreground">
                              {userEmail}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{userEmail}</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  </DropdownMenuLabel>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem onClick={() => setIsProfileOpen(true)}>
                    <UserPen className="size-4" />
                    <span className="ml-2">Edit Profile</span>
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem
                    onClick={handleSignOut}
                    disabled={isPending}
                    className="text-red-600 focus:text-red-600"
                  >
                    <LogOut className="size-4" />
                    <span className="ml-2">
                      {isPending ? "Signing out..." : "Log out"}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </TooltipTrigger>
      </Tooltip>

      <ProfileEditDialog open={isProfileOpen} onOpenChange={setIsProfileOpen} />
    </>
  );
};
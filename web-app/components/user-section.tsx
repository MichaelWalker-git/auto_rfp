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
import { ChevronsUpDown, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import React, { useEffect, useState, useTransition } from "react";

// Amplify Auth (Cognito)
import {
  fetchUserAttributes,
  getCurrentUser,
  signOut,
} from "aws-amplify/auth";
import { useAuth } from '@/components/AuthProvider';

type AuthUser = {
  username: string;
  email?: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
};

export const UserSection: React.FC = () => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isPending, startTransition] = useTransition();
  const { push } = useRouter();
  const { open } = useSidebar();

  useEffect(() => {
    let isMounted = true;

    const loadUser = async () => {
      try {
        const currentUser = await getCurrentUser();
        const attributes = await fetchUserAttributes();

        if (!isMounted) return;

        setUser({
          username: currentUser.username,
          email: attributes.email,
          name: attributes.name,
          given_name: attributes.given_name,
          family_name: attributes.family_name,
          picture: attributes.picture,
        });
      } catch (error) {
        // No authenticated user or error fetching data
        console.error("Error loading Cognito user:", error);
        if (isMounted) {
          setUser(null);
        }
      }
    };

    loadUser();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSignOut = () => {
    startTransition(async () => {
      try {
        await signOut({ global: true });
      } catch (error) {
        console.error("Error signing out:", error);
      }
    });
  };

  const redirectToSettings = () => {
    push("/settings");
  };

  if (!user) {
    return null;
  }

  const displayName =
    user.name ||
    (user.given_name && user.family_name
      ? `${user.given_name} ${user.family_name}`
      : user.given_name) ||
    user.email?.split("@")[0] ||
    user.username ||
    "User";

  const userEmail = user.email || "";

  const avatarUrl = user.picture || "";

  return (
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
                    <AvatarImage src={avatarUrl} alt={displayName} />
                    <AvatarFallback className="bg-purple-600 text-white">
                      {displayName.slice(0, 2).toUpperCase()}
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
                      <AvatarImage src={avatarUrl} alt={displayName} />
                      <AvatarFallback className="bg-purple-600 text-white">
                        {displayName.slice(0, 2).toUpperCase()}
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

                {/* Example: settings item if you want it */}
                {/*
                <DropdownMenuItem onClick={redirectToSettings}>
                  <Settings className="size-4" />
                  <span className="ml-2">Settings</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                */}

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
  );
};

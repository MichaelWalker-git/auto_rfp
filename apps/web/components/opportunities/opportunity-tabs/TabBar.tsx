'use client';

import React from 'react';
import { cn } from '@/lib/utils';
import { TabBarItem, TabBarItemProps } from './TabBarItem';

export interface TabBarProps {
  tabs: TabBarItemProps[];
  activeTab: string;
  onTabChange?: (tabId: string) => void;
  className?: string;
}

export const TabBar = ({ tabs, activeTab, onTabChange, className }: TabBarProps) => {
  return (
    <div className={cn('flex flex-wrap gap-1 border-b pb-2', className)}>
      {tabs.map((tab) => (
        <TabBarItem
          key={tab.id}
          {...tab}
          isActive={tab.id === activeTab}
          onClick={onTabChange}
        />
      ))}
    </div>
  );
};
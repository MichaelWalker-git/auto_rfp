import { DBItem } from '@/helpers/db';
import { DebriefingItem, FOIARequestItem, MonthlyAnalytics } from '@auto-rfp/core';

export type DBDebriefingItem = DebriefingItem & DBItem;

export type DBFOIARequestItem = FOIARequestItem & DBItem;

export type DBMonthlyAnalytics = MonthlyAnalytics & DBItem;

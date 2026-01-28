import { DBItem } from '../helpers/db';
import { ProjectOutcome, DebriefingItem, FOIARequestItem, MonthlyAnalytics } from '@auto-rfp/shared';

export type DBProjectOutcome = ProjectOutcome & DBItem;

export type DBDebriefingItem = DebriefingItem & DBItem;

export type DBFOIARequestItem = FOIARequestItem & DBItem;

export type DBMonthlyAnalytics = MonthlyAnalytics & DBItem;

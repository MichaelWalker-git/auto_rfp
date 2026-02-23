import { lambdaEntry } from './route-helper';
import type { DomainRoutes } from './types';

export const notificationDomain = (): DomainRoutes => ({
  basePath: 'notification',
  routes: [
    { method: 'GET',    path: 'list',          entry: lambdaEntry('notification/list-notifications.ts') },
    { method: 'POST',   path: 'mark-read',     entry: lambdaEntry('notification/mark-read.ts') },
    { method: 'POST',   path: 'mark-all-read', entry: lambdaEntry('notification/mark-all-read.ts') },
    { method: 'DELETE', path: 'archive',        entry: lambdaEntry('notification/archive-notification.ts') },
    { method: 'GET',    path: 'preferences',   entry: lambdaEntry('notification/get-preferences.ts') },
    { method: 'PUT',    path: 'preferences',   entry: lambdaEntry('notification/update-preferences.ts') },
  ],
});

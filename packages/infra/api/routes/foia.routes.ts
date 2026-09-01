import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export function foiaDomain(): DomainRoutes {
  return {
    basePath: 'foia',
    routes: [
      {
        method: 'POST',
        path: 'create-foia-request',
        entry: lambdaEntry('foia/create-foia-request.ts'),
      },
      {
        method: 'GET',
        path: 'get-foia-requests',
        entry: lambdaEntry('foia/get-foia-requests.ts'),
      },
      {
        method: 'POST',
        path: 'generate-foia-letter',
        entry: lambdaEntry('foia/generate-foia-letter.ts'),
      },
      {
        method: 'PATCH',
        path: 'update-foia-request',
        entry: lambdaEntry('foia/update-foia-request.ts'),
      },
      {
        method: 'DELETE',
        path: 'delete-foia-request',
        entry: lambdaEntry('foia/delete-foia-request.ts'),
      },
      {
        method: 'GET',
        path: 'settings/{orgId}',
        entry: lambdaEntry('foia/get-foia-settings.ts'),
      },
      {
        method: 'PATCH',
        path: 'settings/{orgId}',
        entry: lambdaEntry('foia/update-foia-settings.ts'),
      },
      {
        method: 'GET',
        path: 'get-foia-automation',
        entry: lambdaEntry('foia/get-foia-automation.ts'),
      },
      {
        method: 'PATCH',
        path: 'update-foia-automation',
        entry: lambdaEntry('foia/update-foia-automation.ts'),
      },
      {
        method: 'GET',
        path: 'get-foia-agency-contacts',
        entry: lambdaEntry('foia/get-foia-agency-contacts.ts'),
      },
      {
        method: 'POST',
        path: 'upsert-foia-agency-contact',
        entry: lambdaEntry('foia/upsert-foia-agency-contact.ts'),
      },
      {
        method: 'DELETE',
        path: 'delete-foia-agency-contact',
        entry: lambdaEntry('foia/delete-foia-agency-contact.ts'),
      },
      {
        method: 'POST',
        path: 'add-foia-response-document',
        entry: lambdaEntry('foia/add-foia-response-document.ts'),
      },
      {
        method: 'POST',
        path: 'send-foia-request',
        entry: lambdaEntry('foia/send-foia-request.ts'),
      },
      {
        method: 'POST',
        path: 'confirm-foia-recipient',
        entry: lambdaEntry('foia/confirm-foia-recipient.ts'),
      },
      {
        // PATCH: replaces the additional-document list on a prepared request and
        // re-renders its artifacts, so the approved letter stays the sent letter.
        method: 'PATCH',
        path: 'update-foia-custom-documents',
        entry: lambdaEntry('foia/update-foia-custom-documents.ts'),
      },
      {
        // Org-wide comparison aggregate for the dashboard. Read-only, and gated on
        // project:read so every role can see the charts.
        method: 'GET',
        path: 'get-foia-dashboard',
        entry: lambdaEntry('foia/get-foia-dashboard.ts'),
      },
      {
        method: 'POST',
        path: 'submit-to-portal',
        entry: lambdaEntry('foia/submit-to-portal.ts'),
      },
    ],
  };
}

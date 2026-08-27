import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

export interface EmployeeDomainConfig {
  /** SQS queue URL of the extraction pipeline — reused for CV import (ADR-004). */
  extractionQueueUrl: string;
}

/**
 * Employee pool routes (team-definition U1) + CV import (U2).
 * Read endpoints require employee:read; mutations require employee:manage —
 * enforced by the handlers' requirePermission middleware.
 */
export function employeeDomain(config: EmployeeDomainConfig): DomainRoutes {
  return {
    basePath: 'employee',
    routes: [
      {
        method: 'GET',
        path: 'list',
        entry: lambdaEntry('employee/list-employees.ts'),
      },
      {
        method: 'GET',
        path: 'get',
        entry: lambdaEntry('employee/get-employee.ts'),
      },
      {
        method: 'POST',
        path: 'create',
        entry: lambdaEntry('employee/create-employee.ts'),
      },
      {
        method: 'PATCH',
        path: 'update',
        entry: lambdaEntry('employee/update-employee.ts'),
      },
      {
        method: 'DELETE',
        path: 'delete',
        entry: lambdaEntry('employee/delete-employee.ts'),
      },
      // CV import (U2): start a generate-from-CVs run (employee:manage, BR1.1/BR1.2)
      {
        method: 'POST',
        path: 'import/trigger',
        entry: lambdaEntry('employee/trigger-employee-import.ts'),
        timeoutSeconds: 30,
        extraEnv: {
          EXTRACTION_QUEUE_URL: config.extractionQueueUrl,
        },
      },
      // CV import (U2): latest run for progress/completion display (employee:read, BR5.1/BR4.1)
      {
        method: 'GET',
        path: 'import/latest',
        entry: lambdaEntry('employee/get-employee-import-run.ts'),
      },
    ],
  };
}

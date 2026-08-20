import { v4 as uuidv4 } from 'uuid';

import { createItem, getItem, queryBySkPrefix, updateItem, deleteItem } from '@/helpers/db';
import { EMPLOYEE_PK } from '@/constants/employee';
import { PK_NAME, SK_NAME } from '@/constants/common';

import type {
  EmployeeCreateRequest,
  EmployeeDBItem,
  EmployeeItem,
  EmployeeSource,
  EmployeeUpdateRequest,
} from '@auto-rfp/core';

/**
 * Build the sort key for an employee record: `{orgId}#{employeeId}` (BR2.3 —
 * org scoping is the first SK segment). Never construct this string manually.
 */
export const buildEmployeeSk = (orgId: string, employeeId: string): string =>
  `${orgId}#${employeeId}`;

/** Build the SK prefix that scopes a query to one organization. */
export const buildEmployeeSkPrefix = (orgId: string): string => `${orgId}#`;

/** Strip DynamoDB keys, returning the pure domain entity for API responses. */
export const toEmployeeItem = (dbItem: EmployeeDBItem): EmployeeItem => {
  const { [PK_NAME]: _pk, [SK_NAME]: _sk, ...item } = dbItem;
  return item;
};

/**
 * CREATE — persists a new employee with a generated id and provenance marker
 * (BR3.2: MANUAL for hand-entered records, AI_IMPORT for the U2 import flow).
 */
export const createEmployee = async (
  request: EmployeeCreateRequest,
  options?: { source?: EmployeeSource; createdBy?: string },
): Promise<EmployeeItem> => {
  const employeeId = uuidv4();

  const dbItem = await createItem<EmployeeDBItem>(
    EMPLOYEE_PK,
    buildEmployeeSk(request.orgId, employeeId),
    {
      ...request,
      id: employeeId,
      source: options?.source ?? 'MANUAL',
      ...(options?.createdBy ? { createdBy: options.createdBy } : {}),
    },
  );

  return toEmployeeItem(dbItem);
};

/**
 * READ — fetch one employee within the org scope (BR2.3: a record from another
 * org is simply not found).
 */
export const getEmployee = async (
  orgId: string,
  employeeId: string,
): Promise<EmployeeItem | null> => {
  const dbItem = await getItem<EmployeeDBItem>(EMPLOYEE_PK, buildEmployeeSk(orgId, employeeId));
  return dbItem ? toEmployeeItem(dbItem) : null;
};

/**
 * LIST — all employees of an organization (org-prefix query, BR2.3/BR4.1).
 * Search/filter/sort/pagination are applied client-side on this org-scoped set.
 */
export const listEmployeesByOrg = async (orgId: string): Promise<EmployeeItem[]> => {
  const dbItems = await queryBySkPrefix<EmployeeDBItem>(EMPLOYEE_PK, buildEmployeeSkPrefix(orgId));
  return dbItems.map(toEmployeeItem);
};

/**
 * UPDATE — partial patch; identity (orgId, employeeId), provenance and audit
 * fields are immutable (BR3.2). Throws ConditionalCheckFailedException when the
 * record does not exist in this org (surfaces as not-found, BR2.3).
 */
export const updateEmployee = async (
  orgId: string,
  employeeId: string,
  patch: EmployeeUpdateRequest,
): Promise<EmployeeItem> => {
  // Defense in depth: the schema already omits identifiers, but never let a
  // stray identity/provenance field through to the write (BR3.2).
  const forbidden = new Set<string>([
    PK_NAME, SK_NAME, 'id', 'orgId', 'source', 'createdAt', 'updatedAt', 'createdBy',
  ]);
  const safePatch = Object.fromEntries(
    Object.entries(patch).filter(([key, value]) => !forbidden.has(key) && value !== undefined),
  ) as Partial<EmployeeDBItem>;

  const dbItem = await updateItem<EmployeeDBItem>(
    EMPLOYEE_PK,
    buildEmployeeSk(orgId, employeeId),
    safePatch,
  );

  return toEmployeeItem(dbItem);
};

/**
 * DELETE — physical removal from the pool. Never blocked by plan-team
 * references (BR3.1): consumers keep their own name/role snapshot.
 * Returns false when the record was not found in this org (BR2.3).
 */
export const deleteEmployee = async (orgId: string, employeeId: string): Promise<boolean> => {
  const existing = await getItem<EmployeeDBItem>(EMPLOYEE_PK, buildEmployeeSk(orgId, employeeId));
  if (!existing) return false;

  await deleteItem(EMPLOYEE_PK, buildEmployeeSk(orgId, employeeId));
  return true;
};

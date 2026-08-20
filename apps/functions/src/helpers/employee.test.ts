/**
 * Tests for the employee pool DynamoDB helper (team-definition U1).
 * All persistence goes through @/helpers/db — mocked here before imports.
 */

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

const mockCreateItem = jest.fn();
const mockGetItem = jest.fn();
const mockQueryBySkPrefix = jest.fn();
const mockUpdateItem = jest.fn();
const mockDeleteItem = jest.fn();

jest.mock('@/helpers/db', () => ({
  createItem: (...args: unknown[]) => mockCreateItem(...args),
  getItem: (...args: unknown[]) => mockGetItem(...args),
  queryBySkPrefix: (...args: unknown[]) => mockQueryBySkPrefix(...args),
  updateItem: (...args: unknown[]) => mockUpdateItem(...args),
  deleteItem: (...args: unknown[]) => mockDeleteItem(...args),
}));

import {
  buildEmployeeSk,
  buildEmployeeSkPrefix,
  createEmployee,
  getEmployee,
  listEmployeesByOrg,
  updateEmployee,
  deleteEmployee,
} from './employee';
import { EMPLOYEE_PK } from '@/constants/employee';
import { PK_NAME, SK_NAME } from '@/constants/common';

const orgId = 'org-123';
const employeeId = 'emp-456';

const dbEmployee = {
  [PK_NAME]: EMPLOYEE_PK,
  [SK_NAME]: buildEmployeeSk(orgId, employeeId),
  id: employeeId,
  orgId,
  name: 'Jane Smith',
  primaryRoles: ['Project Manager'],
  secondaryRoles: [],
  certifications: ['PMP'],
  source: 'MANUAL',
  createdAt: '2026-08-19T00:00:00.000Z',
  updatedAt: '2026-08-19T00:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildEmployeeSk', () => {
  it('scopes the sort key to the organization first (BR2.3)', () => {
    expect(buildEmployeeSk('org-1', 'emp-1')).toBe('org-1#emp-1');
    expect(buildEmployeeSkPrefix('org-1')).toBe('org-1#');
  });
});

describe('createEmployee', () => {
  it('persists with a generated id and MANUAL source by default (BR3.2)', async () => {
    mockCreateItem.mockImplementation(async (pk: string, sk: string, item: Record<string, unknown>) => ({
      [PK_NAME]: pk,
      [SK_NAME]: sk,
      ...item,
      createdAt: '2026-08-19T00:00:00.000Z',
      updatedAt: '2026-08-19T00:00:00.000Z',
    }));

    const result = await createEmployee({
      orgId,
      name: 'Jane Smith',
      primaryRoles: ['Project Manager'],
      secondaryRoles: [],
      certifications: [],
    });

    expect(mockCreateItem).toHaveBeenCalledTimes(1);
    const [pk, sk, item] = mockCreateItem.mock.calls[0];
    expect(pk).toBe(EMPLOYEE_PK);
    expect(sk).toBe(`${orgId}#${item.id}`);
    expect(item.source).toBe('MANUAL');
    expect(result.id).toBe(item.id);
    expect(result.name).toBe('Jane Smith');
    // Pure domain entity — no DynamoDB keys leak out
    expect(result).not.toHaveProperty(PK_NAME);
    expect(result).not.toHaveProperty(SK_NAME);
  });

  it('records AI_IMPORT provenance when the import flow creates the record', async () => {
    mockCreateItem.mockImplementation(async (pk: string, sk: string, item: Record<string, unknown>) => ({
      [PK_NAME]: pk,
      [SK_NAME]: sk,
      ...item,
    }));

    await createEmployee(
      { orgId, name: 'Bot Import', primaryRoles: [], secondaryRoles: [], certifications: [] },
      { source: 'AI_IMPORT' },
    );

    expect(mockCreateItem.mock.calls[0][2].source).toBe('AI_IMPORT');
  });
});

describe('getEmployee', () => {
  it('returns the domain item within the org scope', async () => {
    mockGetItem.mockResolvedValue(dbEmployee);

    const result = await getEmployee(orgId, employeeId);

    expect(mockGetItem).toHaveBeenCalledWith(EMPLOYEE_PK, `${orgId}#${employeeId}`);
    expect(result?.id).toBe(employeeId);
    expect(result).not.toHaveProperty(PK_NAME);
  });

  it('returns null when the record is missing or in another org (BR2.3)', async () => {
    mockGetItem.mockResolvedValue(null);
    await expect(getEmployee('other-org', employeeId)).resolves.toBeNull();
    expect(mockGetItem).toHaveBeenCalledWith(EMPLOYEE_PK, `other-org#${employeeId}`);
  });
});

describe('listEmployeesByOrg', () => {
  it('queries by the org SK prefix and strips DB keys', async () => {
    mockQueryBySkPrefix.mockResolvedValue([dbEmployee]);

    const items = await listEmployeesByOrg(orgId);

    expect(mockQueryBySkPrefix).toHaveBeenCalledWith(EMPLOYEE_PK, `${orgId}#`);
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe('Jane Smith');
    expect(items[0]).not.toHaveProperty(SK_NAME);
  });
});

describe('updateEmployee', () => {
  it('patches fields while identity and provenance stay immutable (BR3.2)', async () => {
    mockUpdateItem.mockResolvedValue({ ...dbEmployee, name: 'Jane Doe' });

    const result = await updateEmployee(orgId, employeeId, {
      name: 'Jane Doe',
      // These must never reach the write even if smuggled past the schema:
      ...({ id: 'evil', orgId: 'other-org', source: 'AI_IMPORT' } as Record<string, unknown>),
    });

    const [pk, sk, patch] = mockUpdateItem.mock.calls[0];
    expect(pk).toBe(EMPLOYEE_PK);
    expect(sk).toBe(`${orgId}#${employeeId}`);
    expect(patch).toEqual({ name: 'Jane Doe' });
    expect(result.name).toBe('Jane Doe');
  });
});

describe('deleteEmployee', () => {
  it('deletes and reports true when the record exists (never blocked, BR3.1)', async () => {
    mockGetItem.mockResolvedValue(dbEmployee);
    mockDeleteItem.mockResolvedValue({});

    await expect(deleteEmployee(orgId, employeeId)).resolves.toBe(true);
    expect(mockDeleteItem).toHaveBeenCalledWith(EMPLOYEE_PK, `${orgId}#${employeeId}`);
  });

  it('reports false without deleting when the record is not in this org (BR2.3)', async () => {
    mockGetItem.mockResolvedValue(null);

    await expect(deleteEmployee('other-org', employeeId)).resolves.toBe(false);
    expect(mockDeleteItem).not.toHaveBeenCalled();
  });
});

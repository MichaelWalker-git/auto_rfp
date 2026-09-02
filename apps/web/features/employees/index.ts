// Barrel export — pages import from '@/features/employees', never internal paths.

export { EmployeesPageContent } from './components/EmployeesPageContent';
export { EmployeeCreateContent } from './components/EmployeeCreateContent';
export { EmployeeEditContent } from './components/EmployeeEditContent';
export { EmployeeTable, type EmployeeSortDescriptor, type EmployeeSortField } from './components/EmployeeTable';
export { EmployeeTableSkeleton } from './components/EmployeeTableSkeleton';
export { EmployeeEmptyState } from './components/EmployeeEmptyState';
export { EmployeeErrorState } from './components/EmployeeErrorState';
export { EmployeeForm, type EmployeeFormValues, type EmployeeFormOutput } from './components/EmployeeForm';
export { RoleTagInput } from './components/RoleTagInput';
export { ImportProgressBanner } from './components/ImportProgressBanner';
export { ImportResultBanner } from './components/ImportResultBanner';

export { useEmployees, employeesListKey } from './hooks/useEmployees';
export { useEmployeeImport, employeeImportLatestKey } from './hooks/useEmployeeImport';
export { useEmployee } from './hooks/useEmployee';
export {
  useCreateEmployee,
  useUpdateEmployee,
  useDeleteEmployee,
} from './hooks/useEmployeeMutations';
export { useRoleSuggestions } from './hooks/useRoleSuggestions';

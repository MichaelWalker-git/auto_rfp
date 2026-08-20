'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { EmployeeItem, PlanTeamMember } from '@auto-rfp/core';

/** A draft line with a stable local key for list editing. */
export interface DraftTeamMember extends PlanTeamMember {
  _key: string;
}

/** Select sentinel — SelectItem values must be non-empty strings. */
const OPEN_ROLE_VALUE = 'OPEN_ROLE';

interface TeamEditTableProps {
  drafts: DraftTeamMember[];
  employees: EmployeeItem[];
  /** Staffing plan position names offered as role suggestions (BR2.1). */
  roleSuggestions: string[];
  onChangeMember: (key: string, patch: Partial<PlanTeamMember>) => void;
  onRemoveMember: (key: string) => void;
  onAddMember: () => void;
  disabled?: boolean;
}

/**
 * In-place team editing (W3): person picker over the U1 pool, role editor
 * with staffing position suggestions + free text (BR2.1), add/remove lines.
 */
export const TeamEditTable = ({
  drafts,
  employees,
  roleSuggestions,
  onChangeMember,
  onRemoveMember,
  onAddMember,
  disabled,
}: TeamEditTableProps) => {
  const suggestionListId = 'plan-team-role-suggestions';

  const handlePersonChange = (key: string, value: string) => {
    if (value === OPEN_ROLE_VALUE) {
      // Clearing the person makes the line an open slot — snapshots, mark and
      // rationale no longer apply (BR1.3 line shapes).
      onChangeMember(key, {
        employeeId: undefined,
        nameSnapshot: undefined,
        rationale: undefined,
        removedEmployee: false,
        source: 'MANUAL',
      });
      return;
    }
    const employee = employees.find((e) => e.id === value);
    if (!employee) return;
    // Swapping the person invalidates the AI rationale for the old one.
    onChangeMember(key, {
      employeeId: employee.id,
      nameSnapshot: employee.name,
      rationale: undefined,
      removedEmployee: false,
      source: 'MANUAL',
    });
  };

  const handleRoleChange = (key: string, value: string) => {
    // BR2.1 — the ref follows the role text: set when it matches a staffing
    // position, cleared when edited to non-matching free text.
    onChangeMember(key, {
      role: value,
      staffingPositionRef: roleSuggestions.includes(value) ? value : undefined,
    });
  };

  return (
    <div className="space-y-3" data-testid="team-edit-table">
      {roleSuggestions.length > 0 && (
        <datalist id={suggestionListId}>
          {roleSuggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[260px]">Person</TableHead>
            <TableHead className="w-[280px]">Role</TableHead>
            <TableHead className="w-[60px]">
              <span className="sr-only">Remove</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {drafts.map((draft) => (
            <TableRow key={draft._key} data-testid="team-edit-row">
              <TableCell>
                <div className="space-y-1">
                  <Select
                    value={draft.employeeId ?? OPEN_ROLE_VALUE}
                    onValueChange={(value) => handlePersonChange(draft._key, value)}
                    disabled={disabled}
                  >
                    <SelectTrigger data-testid="team-person-select">
                      <SelectValue placeholder="Select a person" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={OPEN_ROLE_VALUE}>Open role (no person)</SelectItem>
                      {employees.map((employee) => (
                        <SelectItem key={employee.id} value={employee.id}>
                          {employee.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {draft.removedEmployee && draft.nameSnapshot && (
                    <Badge variant="destructive" data-testid="removed-employee-badge">
                      {draft.nameSnapshot} — removed from pool
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Input
                  value={draft.role}
                  onChange={(e) => handleRoleChange(draft._key, e.target.value)}
                  placeholder="Role (staffing position or free text)"
                  list={roleSuggestions.length > 0 ? suggestionListId : undefined}
                  disabled={disabled}
                  data-testid="team-role-input"
                />
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemoveMember(draft._key)}
                  disabled={disabled}
                  aria-label="Remove team member"
                  data-testid="team-remove-member"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Button
        variant="outline"
        size="sm"
        onClick={onAddMember}
        disabled={disabled}
        data-testid="team-add-member"
      >
        <Plus className="mr-1.5 h-4 w-4" />
        Add team member
      </Button>
    </div>
  );
};

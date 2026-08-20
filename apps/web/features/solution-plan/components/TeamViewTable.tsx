'use client';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PlanTeamMember } from '@auto-rfp/core';

interface TeamViewTableProps {
  members: PlanTeamMember[];
}

/**
 * Read-only rendering of the plan team (W2): person snapshot, role and match
 * rationale per line. Removed-employee lines render from their snapshot with
 * the pending-replacement mark (BR3.3); unfilled positions render as open
 * roles with no rationale (BR1.3).
 */
export const TeamViewTable = ({ members }: TeamViewTableProps) => {
  if (members.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="team-empty-members">
        The recommended team has no members yet.
      </p>
    );
  }

  return (
    <Table data-testid="team-view-table">
      <TableHeader>
        <TableRow>
          <TableHead className="w-[220px]">Person</TableHead>
          <TableHead className="w-[220px]">Role</TableHead>
          <TableHead>Match rationale</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member, index) => {
          const isUnfilled = !member.employeeId && !member.nameSnapshot;
          return (
            <TableRow key={`${member.role}-${member.employeeId ?? member.nameSnapshot ?? index}`}>
              <TableCell>
                {isUnfilled ? (
                  <Badge variant="outline" data-testid="unfilled-badge">
                    Open role
                  </Badge>
                ) : (
                  <div className="space-y-1">
                    <span className="font-medium">{member.nameSnapshot}</span>
                    {member.removedEmployee && (
                      <Badge
                        variant="destructive"
                        className="block w-fit"
                        data-testid="removed-employee-badge"
                      >
                        Removed from pool — pending replacement
                      </Badge>
                    )}
                  </div>
                )}
              </TableCell>
              <TableCell>{member.role}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {member.rationale ?? '—'}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

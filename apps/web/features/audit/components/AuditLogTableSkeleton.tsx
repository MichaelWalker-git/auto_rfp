import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const COLUMNS = ['Timestamp', 'User', 'Action', 'Resource', 'Resource ID', 'Result', 'IP Address', ''];

export const AuditLogTableSkeleton = () => (
  <div className="rounded-md border overflow-hidden">
    <Table>
      <TableHeader>
        <TableRow className="bg-muted/50">
          {COLUMNS.map((col) => (
            <TableHead key={col} className="text-xs font-medium h-9">{col}</TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 8 }).map((_, i) => (
          <TableRow key={i}>
            <TableCell><Skeleton className="h-4 w-36" /></TableCell>
            <TableCell><Skeleton className="h-4 w-24" /></TableCell>
            <TableCell><Skeleton className="h-5 w-32 rounded-full" /></TableCell>
            <TableCell><Skeleton className="h-4 w-20" /></TableCell>
            <TableCell><Skeleton className="h-4 w-20" /></TableCell>
            <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
            <TableCell><Skeleton className="h-4 w-24" /></TableCell>
            <TableCell />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  </div>
);

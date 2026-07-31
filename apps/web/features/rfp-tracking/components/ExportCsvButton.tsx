'use client';

import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

interface ExportCsvButtonProps {
  onExport: () => void;
  disabled?: boolean;
  label?: string;
}

/** Small "Export CSV" button — mirrors the header export button in RfpTrackingTabs. */
export const ExportCsvButton = ({ onExport, disabled, label = 'Export CSV' }: ExportCsvButtonProps) => (
  <Button variant="outline" size="sm" className="h-8 text-xs" disabled={disabled} onClick={onExport}>
    <Download className="h-3.5 w-3.5" />
    {label}
  </Button>
);

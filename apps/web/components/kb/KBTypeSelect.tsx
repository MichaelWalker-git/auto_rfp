'use client';

import * as React from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, } from '@/components/ui/select';

export type KBType = 'DOCUMENTS' | 'CONTENT_LIBRARY';

const KB_TYPE_OPTIONS: Array<{
  value: KBType;
  label: string;
  description?: string;
}> = [
  {
    value: 'DOCUMENTS',
    label: 'Documents Knowledge Base',
    description: 'Upload and index documents for Q&A and retrieval.',
  },
  {
    value: 'CONTENT_LIBRARY',
    label: 'Content Library',
    description: 'Curated reusable content (snippets, answers, boilerplate).',
  },
];

type Props = {
  id?: string;
  value: KBType;
  onChange: (value: KBType) => void;
  disabled?: boolean;
  label?: string;
  helperText?: string;
};

export function KBTypeSelect({
                               id = 'kbType',
                               value,
                               onChange,
                               disabled,
                               label = 'Type',
                               helperText,
                             }: Props) {
  const selected = KB_TYPE_OPTIONS.find((o) => o.value === value);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>

      <Select value={value} onValueChange={(v) => onChange(v as KBType)} disabled={disabled}>
        <SelectTrigger id={id}>
          <SelectValue placeholder="Select type">
            {selected?.label ?? 'Select type'}
          </SelectValue>
        </SelectTrigger>

        <SelectContent>
          {KB_TYPE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <div className="flex flex-col">
                <span className="font-medium">{opt.label}</span>
                {opt.description ? (
                  <span className="text-xs text-muted-foreground">{opt.description}</span>
                ) : null}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {helperText ? <p className="text-xs text-muted-foreground">{helperText}</p> : null}
    </div>
  );
}
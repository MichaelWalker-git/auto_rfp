'use client';

import { Lightbulb } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

export const TemplateStructureGuidance = () => {
  return (
    <Alert className="mb-3 bg-indigo-50 border-indigo-200">
      <Lightbulb className="h-4 w-4 text-indigo-600" />
      <AlertTitle className="text-indigo-900">Template Structure Tips</AlertTitle>
      <AlertDescription className="mt-1.5 text-sm text-indigo-800">
        <ul className="list-disc list-inside space-y-1">
          <li>
            Use{' '}
            <code className="text-xs bg-indigo-100 px-1 py-0.5 rounded font-mono">&lt;h1&gt;</code>,{' '}
            <code className="text-xs bg-indigo-100 px-1 py-0.5 rounded font-mono">&lt;h2&gt;</code>,{' '}
            <code className="text-xs bg-indigo-100 px-1 py-0.5 rounded font-mono">&lt;h3&gt;</code>{' '}
            for section headings — AI preserves these exactly
          </li>
          <li>Add styling (fonts, colors, spacing) — they'll be preserved in generated documents</li>
          <li>Include images and logos — they'll appear in final documents</li>
          <li>AI generates content for each section while keeping your template structure, styles, and images intact</li>
          <li>
            <strong>Example:</strong> A cover letter template might have{' '}
            <code className="text-xs bg-indigo-100 px-1 py-0.5 rounded font-mono">
              {'{{COMPANY_NAME}}'}
            </code>{' '}
            in the header with your logo and styled headings
          </li>
        </ul>
      </AlertDescription>
    </Alert>
  );
};

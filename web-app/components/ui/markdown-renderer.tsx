'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { cn } from '@/lib/utils';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  // Ensure content is a string - handle cases where an object is passed
  const stringContent = typeof content === 'string' 
    ? content 
    : content == null 
      ? '' 
      : String(content);

  return (
    <div
      className={cn('prose prose-sm max-w-none rounded-lg border ',
        'px-4 py-3',
        `${className}`)}>
      <ReactMarkdown>{stringContent}</ReactMarkdown>
    </div>
  );
}

"use client";

import React from "react";
import { MarkdownRenderer } from "./markdown-renderer";

interface AnswerDisplayProps {
  content: string;
  className?: string;
}

export function AnswerDisplay({ content, className = "" }: AnswerDisplayProps) {
  return (
    <div className={`rounded-md ${className}`}>
      <MarkdownRenderer content={content} />
    </div>
  );
} 
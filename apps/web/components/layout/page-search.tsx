'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface PageSearchProps {
  /** Current search value */
  value: string;
  /** Called when the search value changes */
  onChange: (value: string) => void;
  /** Placeholder text (default: "Search...") */
  placeholder?: string;
  /** Whether the search opens when typing on the page (default: true) */
  isTypeToSearchEnabled?: boolean;
  /** Input width class (default: "w-[250px]") */
  widthClass?: string;
}

export function PageSearch({
  value,
  onChange,
  placeholder = 'Search...',
  isTypeToSearchEnabled = true,
  widthClass = 'w-[250px]',
}: PageSearchProps) {
  const [isVisible, setIsVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open search when user starts typing anywhere on the page
  useEffect(() => {
    if (!isTypeToSearchEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key.length === 1 && !isVisible) {
        setIsVisible(true);
        onChange(e.key);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, onChange, isTypeToSearchEnabled]);

  const handleOpen = useCallback(() => {
    setIsVisible(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const handleBlur = useCallback(() => {
    if (!value.trim()) setIsVisible(false);
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onChange('');
        setIsVisible(false);
      }
    },
    [onChange],
  );

  if (!isVisible) {
    return (
      <Button variant="ghost" size="icon" onClick={handleOpen} aria-label="Search">
        <Search className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        ref={inputRef}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={`pl-9 ${widthClass}`}
        autoFocus
      />
    </div>
  );
}

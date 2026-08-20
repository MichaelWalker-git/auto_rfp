'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface RoleTagInputProps {
  /** Current entries. */
  value: string[];
  /** Change callback with the full next list. */
  onChange: (next: string[]) => void;
  /** Typing suggestions (org labor-rate positions, BR1.5). Free text always accepted. */
  suggestions?: string[];
  placeholder?: string;
  /** Max length per entry (mirrors the schema constraint client-side). */
  maxEntryLength?: number;
  'data-testid'?: string;
  id?: string;
}

/**
 * Tag-style multi-entry input. Suggestions are advisory (BR1.5) — a typed
 * value that matches nothing is accepted as free text on Enter.
 */
export const RoleTagInput = ({
  value,
  onChange,
  suggestions = [],
  placeholder = 'Type a role and press Enter',
  maxEntryLength = 100,
  'data-testid': testId = 'role-tag-input',
  id,
}: RoleTagInputProps) => {
  const [inputText, setInputText] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const filteredSuggestions = useMemo(() => {
    const query = inputText.trim().toLowerCase();
    return suggestions
      .filter((s) => !value.includes(s))
      .filter((s) => (query ? s.toLowerCase().includes(query) : true))
      .slice(0, 8);
  }, [suggestions, value, inputText]);

  const addEntry = (raw: string) => {
    const entry = raw.trim().slice(0, maxEntryLength);
    if (!entry || value.includes(entry)) return;
    onChange([...value, entry]);
    setInputText('');
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const removeEntry = (entry: string) => {
    onChange(value.filter((v) => v !== entry));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addEntry(inputText);
    } else if (e.key === 'Backspace' && !inputText && value.length > 0) {
      removeEntry(value[value.length - 1]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div data-testid={testId} className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid={`${testId}-tags`}>
          {value.map((entry) => (
            <Badge key={entry} variant="secondary" className="max-w-full gap-1 pr-1">
              <span className="truncate">{entry}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-4 w-4 shrink-0 p-0 hover:bg-transparent"
                aria-label={`Remove ${entry}`}
                data-testid={`${testId}-remove-${entry}`}
                onClick={() => removeEntry(entry)}
              >
                <X className="h-3 w-3" />
              </Button>
            </Badge>
          ))}
        </div>
      )}
      <div className="relative">
        <Input
          id={id}
          ref={inputRef}
          value={inputText}
          placeholder={placeholder}
          maxLength={maxEntryLength}
          role="combobox"
          aria-expanded={isOpen && filteredSuggestions.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          data-testid={`${testId}-input`}
          onChange={(e) => {
            setInputText(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => {
            // Delay so a suggestion click lands before the list closes.
            window.setTimeout(() => setIsOpen(false), 150);
          }}
          onKeyDown={handleKeyDown}
        />
        {isOpen && filteredSuggestions.length > 0 && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Role suggestions"
            data-testid={`${testId}-suggestions`}
            className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
          >
            {filteredSuggestions.map((suggestion) => (
              <li key={suggestion} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  data-testid={`${testId}-suggestion-${suggestion}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    addEntry(suggestion);
                  }}
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

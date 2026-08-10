'use client';

import { useRef, useState } from 'react';
import { Image as ImageIcon, Hash, FileText } from 'lucide-react';
import type { PageFurniture, PageFurnitureAlignment } from '@auto-rfp/core';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const ALIGNMENTS: { value: PageFurnitureAlignment; label: string }[] = [
  { value: 'LEFT', label: 'Left' },
  { value: 'CENTER', label: 'Center' },
  { value: 'RIGHT', label: 'Right' },
];

interface FurnitureEditorProps {
  kind: 'header' | 'footer';
  value: PageFurniture;
  onChange: (patch: Partial<PageFurniture>) => void;
  disabled?: boolean;
  /** Uploads a file to S3 and resolves to its key. */
  onUploadImage?: (file: File) => Promise<string>;
}

/**
 * Editor for one piece of page furniture.
 *
 * The content is HTML so it can hold both text and images; an image is inserted
 * as `<img src="s3key:KEY" data-s3-key="KEY">`, matching the convention the
 * template body already uses. That is what lets the export path resolve it —
 * an unresolved key is skipped by the renderers, so this format is load-bearing
 * rather than cosmetic.
 */
export const FurnitureEditor = ({
  kind,
  value,
  onChange,
  disabled = false,
  onUploadImage,
}: FurnitureEditorProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const label = kind === 'header' ? 'Header' : 'Footer';

  /** Insert text at the caret, so a token lands where the user is typing. */
  const insertAtCaret = (snippet: string) => {
    const el = textareaRef.current;
    if (!el) {
      onChange({ html: `${value.html}${snippet}` });
      return;
    }
    const start = el.selectionStart ?? value.html.length;
    const end = el.selectionEnd ?? value.html.length;
    const next = value.html.slice(0, start) + snippet + value.html.slice(end);
    onChange({ html: next });
    requestAnimationFrame(() => {
      el.focus();
      const caret = start + snippet.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const handlePickImage = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onUploadImage) return;

    setUploadError(null);
    setIsUploading(true);
    try {
      const key = await onUploadImage(file);
      insertAtCaret(`<img src="s3key:${key}" data-s3-key="${key}" alt="${label} image">`);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id={`furniture-${kind}-enabled`}
            checked={value.enabled}
            onCheckedChange={(checked) => onChange({ enabled: checked === true })}
            disabled={disabled}
          />
          <Label htmlFor={`furniture-${kind}-enabled`} className="text-sm font-medium">
            Enable {label.toLowerCase()}
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Select
            value={value.align}
            onValueChange={(v) => onChange({ align: v as PageFurnitureAlignment })}
            disabled={disabled || !value.enabled}
          >
            <SelectTrigger className="h-8 w-[110px]" aria-label={`${label} alignment`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALIGNMENTS.map((a) => (
                <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Textarea
        ref={textareaRef}
        value={value.html}
        onChange={(e) => onChange({ html: e.target.value })}
        disabled={disabled || !value.enabled}
        rows={3}
        placeholder={
          kind === 'header'
            ? 'e.g. <p>{{COMPANY_NAME}} — {{PROJECT_TITLE}}</p>'
            : 'e.g. <p>Page {{PAGE_NUMBER}} of {{TOTAL_PAGES}}</p>'
        }
        className="font-mono text-xs"
        aria-label={`${label} content`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handlePickImage}
          disabled={disabled || !value.enabled || !onUploadImage || isUploading}
        >
          <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
          {isUploading ? 'Uploading…' : 'Insert image'}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => insertAtCaret('{{PAGE_NUMBER}}')}
          disabled={disabled || !value.enabled}
        >
          <Hash className="h-3.5 w-3.5 mr-1.5" />
          Page number
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => insertAtCaret('{{TOTAL_PAGES}}')}
          disabled={disabled || !value.enabled}
        >
          <FileText className="h-3.5 w-3.5 mr-1.5" />
          Total pages
        </Button>

        <div className="flex items-center gap-1.5 ml-auto">
          <Label htmlFor={`furniture-${kind}-height`} className="text-xs text-slate-500">
            Height (in)
          </Label>
          <Input
            id={`furniture-${kind}-height`}
            type="number"
            step="0.1"
            min="0"
            max="3"
            value={value.heightIn}
            onChange={(e) => {
              const parsed = Number.parseFloat(e.target.value);
              onChange({ heightIn: Number.isFinite(parsed) ? parsed : 0 });
            }}
            disabled={disabled || !value.enabled}
            className="h-8 w-20"
          />
        </div>
      </div>

      {uploadError && (
        <p className="text-xs text-red-600" role="alert">{uploadError}</p>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/bmp"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
};

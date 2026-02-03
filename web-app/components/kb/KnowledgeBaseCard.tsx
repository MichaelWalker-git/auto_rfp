'use client';

import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/components/brief/helpers';
import { KnowledgeBase } from '@auto-rfp/shared';
import { Edit2, Trash2 } from 'lucide-react';

type Props = {
  kb: KnowledgeBase;
  onOpen?: (kb: KnowledgeBase) => void;
  onEdit?: (kb: KnowledgeBase) => void;
  onDelete?: (kb: KnowledgeBase) => void;
};

const KnowledgeBaseCard = ({ kb, onOpen, onEdit, onDelete }: Props) => {
  const countLabel =
    kb.type === 'CONTENT_LIBRARY'
      ? `${kb?._count?.questions ?? 0} questions`
      : `${kb?._count?.documents ?? 0} documents`;

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.(kb);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.(kb);
  };


  return (
    <Card
      onClick={() => onOpen?.(kb)}
      className="
        group relative cursor-pointer flex flex-col h-full overflow-hidden
        transition-all duration-200
        hover:shadow-md hover:border-primary/20
      from-background to-muted/30
      "
    >

      <CardHeader className="pb-2 pt-4 px-4 flex-1 flex flex-col gap-2">
        {/* Title + actions row */}
        <div className="flex w-full items-start gap-2">
          {/* Title */}
          <CardTitle className="flex-1 min-w-0 text-base font-semibold leading-tight line-clamp-2">
            {kb.name}
          </CardTitle>

          {/* Actions — right side, hover only */}
          {(onEdit || onDelete) && (
            <div
              className="
          flex items-center gap-1 shrink-0 ml-auto
          opacity-0 pointer-events-none
          transition-opacity
          group-hover:opacity-100 group-hover:pointer-events-auto
        "
              onClick={(e) => e.stopPropagation()}
            >
              {onEdit && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={handleEdit}
                  title="Edit knowledge base"
                >
                  <Edit2 className="size-4"/>
                </Button>
              )}

              {onDelete && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 hover:text-destructive hover:bg-destructive/10"
                  onClick={handleDelete}
                  title="Delete knowledge base"
                >
                  <Trash2 className="size-4"/>
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Description */}
        {kb.description ? (
          <CardDescription className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {kb.description}
          </CardDescription>
        ) : (
          <CardDescription className="text-xs text-muted-foreground/50 italic">
            No description
          </CardDescription>
        )}
      </CardHeader>

      {/* Footer */}
      <CardContent className="px-4 py-3 mt-auto border-t border-border/50">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground/70">Updated {formatDate(kb.updatedAt)}</p>

          <Badge variant="outline" className="text-[10px] tracking-wide">
            {countLabel}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
};

export default KnowledgeBaseCard;
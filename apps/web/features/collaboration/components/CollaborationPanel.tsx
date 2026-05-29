'use client';

import type { CommentEntityType } from '@auto-rfp/core';
import { CommentThread } from './CommentThread';

interface CollaborationPanelProps {
  projectId: string;
  orgId: string;
  entityType: CommentEntityType;
  entityId: string;
  entityPk: string;
  entitySk: string;
  currentUserId: string;
  canComment: boolean;
}

export function CollaborationPanel({
  projectId,
  orgId,
  entityType,
  entityId,
  entityPk,
  entitySk,
  currentUserId,
  canComment,
}: CollaborationPanelProps) {
  return (
    <div className="flex flex-col h-full">
      <CommentThread
        projectId={projectId}
        orgId={orgId}
        entityType={entityType}
        entityId={entityId}
        entityPk={entityPk}
        entitySk={entitySk}
        currentUserId={currentUserId}
        canComment={canComment}
      />
    </div>
  );
}

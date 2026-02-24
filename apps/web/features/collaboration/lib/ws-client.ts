'use client';

import type { WsOutboundMessage } from '@auto-rfp/core';

type MessageHandler = (msg: WsOutboundMessage) => void;

interface WsClientOptions {
  wsUrl: string;
  token: string;
  projectId: string;
  orgId: string;
  onMessage: MessageHandler;
  onOpen?: () => void;
  onClose?: () => void;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(private readonly opts: WsClientOptions) {}

  connect(): void {
    const { wsUrl, token, projectId, orgId } = this.opts;
    const url = `${wsUrl}?token=${encodeURIComponent(token)}&projectId=${projectId}&orgId=${orgId}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.opts.onOpen?.();
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WsOutboundMessage;
        this.opts.onMessage(msg);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.stopHeartbeat();
      this.opts.onClose?.();
      if (!this.closed) {
        // Reconnect after 3 seconds
        this.reconnectTimer = setTimeout(() => this.connect(), 3000);
      }
    };
  }

  send(type: string, payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  updatePresence(questionId: string | undefined, status: string): void {
    this.send('HEARTBEAT', { projectId: this.opts.projectId, questionId, status });
  }

  lockEditing(questionId: string): void {
    this.send('EDITING_LOCK', { projectId: this.opts.projectId, questionId });
  }

  unlockEditing(questionId: string): void {
    this.send('EDITING_UNLOCK', { projectId: this.opts.projectId, questionId });
  }

  /** Send a live answer text delta to all collaborators on the same question */
  sendAnswerDelta(questionId: string, text: string): void {
    this.send('ANSWER_DELTA', { projectId: this.opts.projectId, questionId, text });
  }

  /** Send answer metadata (status, last edited by, approved by) to collaborators */
  sendAnswerStatus(questionId: string, meta: {
    status?: string;
    updatedByName?: string;
    updatedAt?: string;
    approvedByName?: string;
    approvedAt?: string;
  }): void {
    this.send('ANSWER_STATUS', { projectId: this.opts.projectId, questionId, ...meta });
  }

  disconnect(): void {
    this.closed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send('HEARTBEAT', { projectId: this.opts.projectId, status: 'viewing' });
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

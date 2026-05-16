import type { ChatDebugEvent, ChatDebugStatus } from '@giga/shared/types/contracts/chat.types';

type ChatLogLevel = 'debug' | 'info' | 'warn' | 'error';

type ChatLogger = {
  debug: (event: string, metadata?: Record<string, unknown>) => void;
  info: (event: string, metadata?: Record<string, unknown>) => void;
  warn: (event: string, metadata?: Record<string, unknown>) => void;
  error: (event: string, metadata?: Record<string, unknown>) => void;
};

type ChatTelemetryInput = {
  chatId?: string | null;
  debug?: { emit?: ((event: ChatDebugEvent) => void) | null; emitEnabled?: boolean; emitRoom?: string | null; requestId?: string | null } | null;
  logger: ChatLogger;
  requestId?: string | null;
};

type ChatTelemetryEvent = {
  eventName: string;
  level?: ChatLogLevel;
  stage: string;
  status: ChatDebugStatus;
  message: string;
  meta?: Record<string, unknown>;
  chatId?: string | null;
  emit?: boolean;
  emitRoom?: string | null;
  requestId?: string | null;
};

const isEmitEnabled = (value: unknown): boolean => value !== false;

export const createChatTelemetry = (input: ChatTelemetryInput) => {
  const requestId = input.requestId || input.debug?.requestId || null;
  const defaultEmitEnabled = isEmitEnabled(input.debug?.emitEnabled);
  const defaultEmitRoom = input.debug?.emitRoom || null;
  return {
    emit: (event: ChatTelemetryEvent) => {
      const level = event.level || 'info';
      const chatId = event.chatId || input.chatId || null;
      const emitEnabled = event.emit === undefined ? defaultEmitEnabled : event.emit === true;
      const emitRoom = event.emitRoom || defaultEmitRoom || null;
      const debugEvent: ChatDebugEvent = {
        stage: event.stage,
        status: event.status,
        message: event.message,
        timestamp: new Date().toISOString(),
        chat_id: chatId,
        request_id: event.requestId || requestId,
        emit: emitEnabled,
        emit_room: emitRoom,
        meta: event.meta || {},
      };
      input.logger[level](event.eventName, {
        chat_id: chatId,
        request_id: debugEvent.request_id || null,
        stage: event.stage,
        status: event.status,
        message: event.message,
        emit: emitEnabled,
        emit_room: emitRoom,
        ...(event.meta || {}),
      });
      if (emitEnabled && typeof input.debug?.emit === 'function') input.debug.emit(debugEvent);
      return debugEvent;
    },
  };
};

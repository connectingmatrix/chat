import { getScopedLogger, toErrorMeta } from '@connectingmatrix/logger/lib/logger';

type ChatSideEffectLogger = ReturnType<typeof getScopedLogger>;

export function observeChatSideEffect(promise: Promise<unknown>, logger: ChatSideEffectLogger, eventName: string, meta: Record<string, unknown>) {
  promise.catch((error) => {
    // prettier-ignore
    logger.warn(eventName, { ...meta, error: toErrorMeta(error) as Record<string, unknown> });
  });
}

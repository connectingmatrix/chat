export enum ChatExecutionModeEnum {
  Wait = 'wait',
  Async = 'async',
}

export enum ChatRuntimeEngineEnum {
  Agent = 'agent',
}

export type ChatRuntimeMetadata = {
  chat_runtime_engine?: ChatRuntimeEngineEnum | null;
  chatRuntimeEngine?: ChatRuntimeEngineEnum | null;
  chat_engine?: ChatRuntimeEngineEnum | null;
  chatEngine?: ChatRuntimeEngineEnum | null;
};

export type ChatSessionMetadata = ChatRuntimeMetadata & {
  chat_execution_mode?: ChatExecutionModeEnum | null;
  chatExecutionMode?: ChatExecutionModeEnum | null;
};

export const resolveChatRuntimeEngineFromMetadata = (_metadata: ChatRuntimeMetadata | null | undefined): ChatRuntimeEngineEnum =>
  ChatRuntimeEngineEnum.Agent;

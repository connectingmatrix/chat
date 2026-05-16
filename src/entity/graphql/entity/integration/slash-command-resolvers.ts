import { createSlashHints, executeSlashCommand } from '@connectingmatrix/chat/services/chat/slash/slash-command-registry';

export const slashCommandResolvers = {
  Query: {
    slashHints: async (_parent: unknown, args: Record<string, unknown>) =>
      (await createSlashHints((args.input || args) as Record<string, unknown>)).hints,
  },
  Mutation: {
    executeSlashCommand: async (_parent: unknown, args: Record<string, unknown>) =>
      executeSlashCommand((args.input || args) as Record<string, unknown>),
  },
};

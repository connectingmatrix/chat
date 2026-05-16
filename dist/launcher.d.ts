import { type PackageLauncherPanel, type RequestContext } from './contracts.js';
export declare function createConnectingmatrixChatStubLauncher(context?: RequestContext): PackageLauncherPanel;
export declare const createStubLauncher: typeof createConnectingmatrixChatStubLauncher;
export declare const Launcher: {
    open: typeof createConnectingmatrixChatStubLauncher;
    mode: "stub";
};
export declare const launcher: typeof createConnectingmatrixChatStubLauncher;

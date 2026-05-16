import { type PackageLauncherPanel, type RequestContext } from '../contracts.js';
export declare function createPackageStatusPanel(context?: RequestContext): PackageLauncherPanel;
export declare const Launcher: {
    open: typeof createPackageStatusPanel;
    mode: "connected";
};
export declare const launcher: typeof createPackageStatusPanel;

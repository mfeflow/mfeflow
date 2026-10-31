import type { ModuleFederationRuntimePlugin } from '@module-federation/enhanced/runtime';

// Runtime plugins run before the async boundary, so this file imports nothing
// at runtime (no react, no shared @mfeflow packages). It mirrors report.ts.
const EVENT = 'mfeflow:remote-error';

declare global {
  var mfeflowReports: { mfe: string; where: string; message: string; time: number }[] | undefined;
}

/** Reports every Module Federation load failure with the remote's name. */
export default function mfeflowReportPlugin(): ModuleFederationRuntimePlugin {
  return {
    name: 'mfeflow-report',
    errorLoadRemote(args) {
      const mfe = args.id.split('/')[0] ?? args.id;
      const report = {
        mfe,
        where: `errorLoadRemote:${args.lifecycle}`,
        message: args.error instanceof Error ? args.error.message : String(args.error),
        time: Date.now(),
      };
      (globalThis.mfeflowReports ??= []).push(report);
      if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent(EVENT, { detail: report }));
      }
      // Returning nothing lets the error reach the caller, which renders a fallback.
      return undefined;
    },
  };
}

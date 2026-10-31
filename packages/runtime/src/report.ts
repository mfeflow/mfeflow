export interface RemoteErrorReport {
  /** Remote name, e.g. `cart`. */
  mfe: string;
  /** Where it failed: `load`, `render`, `registry`, or `errorLoadRemote:<lifecycle>`. */
  where: string;
  message: string;
  time: number;
}

/** Fired on `window` for every report; telemetry and the dev overlay listen to it. */
export const REMOTE_ERROR_EVENT = 'mfeflow:remote-error';

declare global {
  var mfeflowReports: RemoteErrorReport[] | undefined;
}

export function reportRemoteError(mfe: string, where: string, error: unknown): RemoteErrorReport {
  const report: RemoteErrorReport = {
    mfe,
    where,
    message: error instanceof Error ? error.message : String(error),
    time: Date.now(),
  };
  (globalThis.mfeflowReports ??= []).push(report);
  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent<RemoteErrorReport>(REMOTE_ERROR_EVENT, { detail: report }),
    );
  }
  console.error(`[mfeflow] ${mfe} ${where}: ${report.message}`);
  return report;
}

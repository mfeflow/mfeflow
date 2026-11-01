export interface RemoteErrorReport {
  /** Remote name, e.g. `cart`. */
  mfe: string;
  /** Where it failed: `load`, `render`, `registry`, or `errorLoadRemote:<lifecycle>`. */
  where: string;
  message: string;
  time: number;
  /** The registered version of the remote, when the registry gave one. */
  version?: string;
}

// On globalThis so the runtime plugins (which import nothing) read the same map.
const VERSIONS = Symbol.for('mfeflow.remote-versions');

const isVersionMap = (value: unknown): value is Map<string, string> => value instanceof Map;

function versionMap(): Map<string, string> {
  const existing: unknown = Reflect.get(globalThis, VERSIONS);
  if (isVersionMap(existing)) return existing;
  const created = new Map<string, string>();
  Reflect.set(globalThis, VERSIONS, created);
  return created;
}

/** The version the registry gave this remote on this page, if any. */
export const remoteVersion = (mfe: string): string | undefined => versionMap().get(mfe);

/** Remembers each remote's version so its reports say `cart@1.2.3`. Replaces what was remembered before. */
export function rememberRemoteVersions(remotes: readonly { name: string; version?: string }[]) {
  const versions = versionMap();
  versions.clear();
  for (const { name, version } of remotes) if (version !== undefined) versions.set(name, version);
}

/** Fired on `window` for every report; telemetry and the dev overlay listen to it. */
export const REMOTE_ERROR_EVENT = 'mfeflow:remote-error';

declare global {
  var mfeflowReports: RemoteErrorReport[] | undefined;
}

export function reportRemoteError(mfe: string, where: string, error: unknown): RemoteErrorReport {
  const version = versionMap().get(mfe);
  const report: RemoteErrorReport = {
    mfe,
    where,
    message: error instanceof Error ? error.message : String(error),
    time: Date.now(),
    ...(version === undefined ? {} : { version }),
  };
  (globalThis.mfeflowReports ??= []).push(report);
  if (typeof window !== 'undefined' && typeof CustomEvent === 'function') {
    window.dispatchEvent(
      new CustomEvent<RemoteErrorReport>(REMOTE_ERROR_EVENT, { detail: report }),
    );
  }
  console.error(
    `[mfeflow] ${version === undefined ? mfe : `${mfe}@${version}`} ${where}: ${report.message}`,
  );
  return report;
}

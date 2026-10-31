import { useEffect, useState } from 'react';
import { registeredRemotes } from './registry';
import { REMOTE_ERROR_EVENT, type RemoteErrorReport } from './report';

export interface DevOverlayProps {
  /** Render nothing unless true (e.g. `import.meta.env.DEV`). */
  enabled: boolean;
  /** Start open. Default false; toggle with Alt+Shift+M. */
  open?: boolean;
}

const box = {
  position: 'fixed',
  insetBlockEnd: '12px',
  insetInlineEnd: '12px',
  zIndex: 2147483647,
  maxWidth: '420px',
  maxHeight: '60vh',
  overflow: 'auto',
  padding: '12px',
  borderRadius: '8px',
  font: '12px/1.4 ui-monospace, monospace',
  background: '#111827',
  color: '#e5e7eb',
  boxShadow: '0 8px 24px rgba(0,0,0,.35)',
} as const;

/**
 * Dev-only panel: which remotes and versions the shell registered (overrides
 * marked), and every remote error as it happens. Alt+Shift+M toggles it.
 */
export function DevOverlay({ enabled, open = false }: DevOverlayProps) {
  const [visible, setVisible] = useState(open);
  const [reports, setReports] = useState<readonly RemoteErrorReport[]>(
    () => globalThis.mfeflowReports ?? [],
  );

  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyM') setVisible((v) => !v);
    };
    const onReport = () => {
      setReports([...(globalThis.mfeflowReports ?? [])]);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(REMOTE_ERROR_EVENT, onReport);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(REMOTE_ERROR_EVENT, onReport);
    };
  }, [enabled]);

  if (!enabled || !visible) return null;
  const remotes = registeredRemotes();
  return (
    <aside style={box} aria-label="mfeflow dev overlay" data-mfeflow-overlay="">
      <strong>mfeflow</strong> · {remotes.length} remotes
      <ul style={{ margin: '8px 0', paddingInlineStart: '16px' }}>
        {remotes.map((r) => (
          <li key={r.name}>
            {r.name} <span style={{ opacity: 0.7 }}>{r.version ?? 'unversioned'}</span>
            {r.version === 'override' ? ' (override)' : null}
          </li>
        ))}
      </ul>
      {reports.length > 0 ? (
        <>
          <strong>errors</strong>
          <ul style={{ margin: '8px 0', paddingInlineStart: '16px', color: '#fca5a5' }}>
            {reports.map((r) => (
              <li key={`${String(r.time)}-${r.mfe}-${r.where}`}>
                {r.mfe} · {r.where}: {r.message}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </aside>
  );
}

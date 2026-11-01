import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;

export function CopyCommand({ command }: { command: string }) {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [status, setStatus] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setStatus('Copied');
    } catch {
      setStatus('Copy failed, select the command instead');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(''), 2000);
  }

  return (
    <div className="mf-install">
      <code className="mf-install__cmd">
        <span aria-hidden="true">$ </span>
        {command}
      </code>
      {ready && (
        <button type="button" className="mf-install__copy" onClick={() => void copy()}>
          {status === 'Copied' ? 'copied' : 'copy'}
        </button>
      )}
      <output className="mf-sr" aria-live="polite">
        {status}
      </output>
    </div>
  );
}

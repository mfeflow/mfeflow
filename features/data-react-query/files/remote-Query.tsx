import { useContext, type ReactNode } from 'react';
import { QueryClient, QueryClientContext, QueryClientProvider } from '@tanstack/react-query';

let standalone: QueryClient | undefined;

/**
 * Inside the shell this does nothing: the shell's client is already in context. When the remote runs on its own
 * (`pnpm dev` in its folder) there is no shell, so it provides a client of its own.
 */
export function Query({ children }: { children: ReactNode }) {
  const inShell = useContext(QueryClientContext) !== undefined;
  if (inShell) return children;
  standalone ??= new QueryClient();
  return <QueryClientProvider client={standalone}>{children}</QueryClientProvider>;
}

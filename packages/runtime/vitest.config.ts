import { defineProject } from 'vitest/config';
import { workspaceAliases } from '../../vitest.shared.ts';

export default defineProject({
  resolve: { alias: workspaceAliases },
  test: { environment: 'jsdom' },
});

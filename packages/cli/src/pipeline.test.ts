import { describe, expect, it } from 'vitest';
import { emptyPlan, serializeProject, type MfeflowProject, type Plan } from '@mfeflow/core';
import { raiseCli, stampCli } from './pipeline';
import { readPackageJson } from './version';

const running = readPackageJson().version;
const project: MfeflowProject = {
  version: 1,
  topology: 'monorepo',
  packageManager: 'pnpm',
  scope: '@shop',
  apps: { shell: { kind: 'shell', path: 'apps/shell' } },
  features: {},
};
const planFor = (stored: MfeflowProject, changed: boolean): Plan => ({
  ...emptyPlan(),
  features: changed ? [{ name: 'forms', version: '0.1.0' }] : [],
  projectBefore: serializeProject(stored),
});

describe('raiseCli', () => {
  it('sets cli when missing or older, and keeps a newer or equal one', () => {
    expect(raiseCli(project).cli).toBe(running);
    expect(raiseCli({ ...project, cli: '0.0.1' }).cli).toBe(running);
    expect(raiseCli({ ...project, cli: '99.0.0' }).cli).toBe('99.0.0');
    expect(raiseCli({ ...project, cli: running }).cli).toBe(running);
  });
});

describe('stampCli', () => {
  it('stamps when the plan changes something', () => {
    expect(stampCli(project, planFor(project, true)).cli).toBe(running);
  });

  it('leaves the project alone when the plan changes nothing', () => {
    expect(stampCli(project, planFor(project, false))).toBe(project);
    const old = { ...project, cli: '0.0.1' };
    expect(stampCli(old, planFor(old, false))).toBe(old);
  });

  it('never lowers cli', () => {
    const newer = { ...project, cli: '99.0.0' };
    expect(stampCli(newer, planFor(newer, true)).cli).toBe('99.0.0');
  });
});

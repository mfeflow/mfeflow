import { compatProblems, comparable, type CompatProblem } from '@mfeflow/registry/static';
import { finding, type Check, type Finding } from '../findings';
import { versionIn, type AppView, type ProjectView } from '../inspect';
import { SINGLETON_PACKAGES } from '../singletons';
import { unresolved } from './singletons';

/** Where the shell's versions come from when it is not in this repo. */
export interface AgainstShell {
  from: string;
  manifest: unknown;
}

export const ABSENT_SHELL_WARNING = 'shell is not in this repo, pass --against <url|file>';
const ABSENT_UNDER_DOCTOR = 'shell is not in this repo, run `mfeflow doctor --against <url|file>`';

async function versionsOf(app: AppView, names: readonly string[], root: string) {
  const found = await Promise.all(
    names.map(async (name) => [name, await versionIn(app, name, root)] as const),
  );
  return found.flatMap(([name, version]) =>
    version === undefined ? [] : [[name, version] as const],
  );
}

function describe(p: CompatProblem, remote: string, shell: string): string {
  const needs = `${remote} needs ${p.name} ${p.range} (${p.source})`;
  return `${needs} but ${shell} has ${p.provided}`;
}

async function compatFor(
  remote: AppView,
  shell: { name: string; manifest?: unknown; app?: AppView },
  root: string,
): Promise<Finding[]> {
  const out: Finding[] = [];
  const at = { app: remote.name, path: remote.appFile };
  const platform = remote.mfe.state === 'ok' ? (remote.mfe.value.platform ?? {}) : {};
  const installed = await versionsOf(remote, SINGLETON_PACKAGES, root);
  // Module Federation asks for ^<the remote's installed version>; a platform range replaces that ask.
  const shared = installed.flatMap(([name, version]) => {
    const want = comparable(version);
    if (want === undefined) {
      out.push(unresolved('compat', 'E302', name, [`${remote.name} ${version}`]));
      return [];
    }
    return name in platform ? [] : [{ name, singleton: true, requiredVersion: `^${want}` }];
  });
  const names = [...new Set([...SINGLETON_PACKAGES, ...Object.keys(platform)])];
  const workspaceVersions =
    shell.app === undefined
      ? undefined
      : Object.fromEntries(await versionsOf(shell.app, names, root));
  for (const p of compatProblems({
    remoteManifest: { shared },
    platform,
    shellManifest: shell.manifest,
    workspaceVersions,
  })) {
    if (p.kind === 'unresolved') {
      out.push(
        unresolved('compat', 'E302', p.name, [`${shell.name} ${p.provided || 'with no version'}`]),
      );
    } else if (p.source === 'shared') {
      const want = p.range.replace(/^\^/, '');
      out.push(
        finding(
          'compat',
          'E302',
          `${remote.name} uses ${p.name} ${want}, ${shell.name} provides ${p.provided}`,
          {
            app: remote.name,
          },
        ),
      );
    } else out.push(finding('compat', 'E302', describe(p, remote.name, shell.name), at));
  }
  return out;
}

const dedupe = (findings: Finding[]): Finding[] => {
  const seen = new Set<string>();
  return findings.filter((f) => !seen.has(f.message) && Boolean(seen.add(f.message)));
};

/**
 * Each remote's shared ranges against the shell. The shell comes from `against` (a deployed
 * manifest) when given, else from the shells in this repo; with neither, the check warns
 * instead of passing.
 */
export function compatCheck(
  against?: AgainstShell,
  under: 'check-compat' | 'doctor' = 'check-compat',
): Check {
  return {
    id: 'compat',
    title: "each remote's shared ranges fit the shells it runs in",
    async run(view: ProjectView) {
      const remotes = view.apps.filter((a) => a.kind === 'remote' && a.present);
      if (against !== undefined) {
        const found = await Promise.all(
          remotes.map((remote) =>
            compatFor(remote, { name: 'the shell', manifest: against.manifest }, view.root),
          ),
        );
        return { findings: dedupe(found.flat()) };
      }
      const out: Finding[] = [];
      let missing = false;
      for (const remote of remotes) {
        const names =
          remote.mfe.state === 'ok'
            ? remote.mfe.value.shells
            : view.apps.filter((a) => a.kind === 'shell').map((a) => a.name);
        const shells = view.apps.filter(
          (a) => a.kind === 'shell' && a.present && names.includes(a.name),
        );
        if (shells.length === 0) missing = true;
        for (const shell of shells) {
          // oxlint-disable-next-line no-await-in-loop -- a few apps
          out.push(...(await compatFor(remote, { name: shell.name, app: shell }, view.root)));
        }
      }
      if (missing)
        out.push(
          finding(
            'compat',
            'E302',
            under === 'doctor' ? ABSENT_UNDER_DOCTOR : ABSENT_SHELL_WARNING,
            { severity: 'warning' },
          ),
        );
      return { findings: dedupe(out) };
    },
  };
}

export const compat: Check = compatCheck(undefined, 'doctor');

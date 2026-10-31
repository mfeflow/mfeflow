import semver from 'semver';
import { finding, type Check, type Finding } from '../findings';
import { versionIn, type AppView, type ProjectView } from '../inspect';
import { SINGLETON_PACKAGES } from '../singletons';
import { comparable } from './singletons';

/** Does `shellVersion` satisfy what the remote asks for? Unknown versions pass: nothing to compare. */
function fits(range: string, shellVersion: string | undefined): boolean {
  if (shellVersion === undefined) return true;
  const have = comparable(shellVersion);
  const valid = semver.validRange(range);
  return have === undefined || valid === null || semver.satisfies(have, valid);
}

async function compatFor(shell: AppView, remote: AppView): Promise<Finding[]> {
  const out: Finding[] = [];
  const at = { app: remote.name, path: `${remote.rel}/mfe.json` };
  const platform = remote.mfe.state === 'ok' ? (remote.mfe.value.platform ?? {}) : {};
  for (const [name, range] of Object.entries(platform)) {
    // oxlint-disable-next-line no-await-in-loop -- a few packages
    const have = await versionIn(shell, name);
    if (!fits(range, have)) {
      out.push(
        finding(
          'compat',
          'E302',
          `${remote.name} needs ${name} ${range} (mfe.json platform) but ${shell.name} has ${String(have)}`,
          at,
        ),
      );
    }
  }
  for (const name of SINGLETON_PACKAGES) {
    // oxlint-disable-next-line no-await-in-loop -- a few packages
    const [theirs, mine] = [await versionIn(remote, name), await versionIn(shell, name)];
    const want = theirs === undefined ? undefined : comparable(theirs);
    if (want === undefined || mine === undefined) continue;
    // Module Federation asks for ^<the remote's installed version> and the shell provides its own.
    if (!fits(`^${want}`, mine) && !(name in platform)) {
      out.push(
        finding(
          'compat',
          'E302',
          `${remote.name} uses ${name} ${want}, ${shell.name} provides ${mine}`,
          {
            app: remote.name,
          },
        ),
      );
    }
  }
  return out;
}

export const compat: Check = {
  id: 'compat',
  title: "each remote's shared ranges fit the shells it runs in",
  async run(view: ProjectView) {
    const out: Finding[] = [];
    const remotes = view.apps.filter((a) => a.kind === 'remote' && a.present);
    for (const remote of remotes) {
      const names =
        remote.mfe.state === 'ok'
          ? remote.mfe.value.shells
          : view.apps.filter((a) => a.kind === 'shell').map((a) => a.name);
      for (const shell of view.apps.filter(
        (a) => a.kind === 'shell' && a.present && names.includes(a.name),
      )) {
        // oxlint-disable-next-line no-await-in-loop -- a few apps
        out.push(...(await compatFor(shell, remote)));
      }
    }
    return { findings: out };
  },
};

import path from 'node:path';
import { routesOverlap } from '@mfeflow/contracts';
import { findDiverged } from '@mfeflow/core';
import { done, finding, type Check } from '../findings';
import { ENVS, type Read } from '../inspect';
import { scanCheckout } from '../local';

function issueText(read: Read<unknown>): string {
  return read.state === 'invalid'
    ? read.issues.map((i) => `${i.path || '(root)'} ${i.message}`).join('; ')
    : '';
}

export const appsOnDisk: Check = {
  id: 'config.apps',
  title: 'every app in mfeflow.json is on disk',
  run: ({ apps }) =>
    done(
      apps
        .filter((app) => !app.present)
        .map((app) =>
          finding('config.apps', 'E112', `${app.name} (${app.rel}/package.json not found)`, {
            app: app.name,
            path: `${app.rel}/package.json`,
          }),
        ),
    ),
};

export const mfeJson: Check = {
  id: 'config.mfe-json',
  title: 'every app has a valid mfeflow.app.json that matches mfeflow.json',
  run: ({ apps }) =>
    done(
      apps
        .filter((app) => app.present)
        .flatMap((app) => {
          const at = { app: app.name, path: app.appFile };
          if (app.mfe.state === 'missing') {
            return [finding('config.mfe-json', 'E113', `${app.name} has no mfeflow.app.json`, at)];
          }
          if (app.mfe.state === 'invalid') {
            return [finding('config.mfe-json', 'E113', `${app.name}: ${issueText(app.mfe)}`, at)];
          }
          const { name } = app.mfe.value;
          return name === app.name
            ? []
            : [
                finding(
                  'config.mfe-json',
                  'E116',
                  `${app.appFile} names "${name}" but the app is "${app.name}"`,
                  at,
                ),
              ];
        }),
    ),
};

export const ports: Check = {
  id: 'config.ports',
  title: 'no two apps share a port',
  run: ({ apps }) => {
    const byPort = new Map<number, string[]>();
    for (const app of apps) {
      if (app.port !== undefined) byPort.set(app.port, [...(byPort.get(app.port) ?? []), app.name]);
    }
    return done(
      [...byPort]
        .filter(([, names]) => names.length > 1)
        .map(([port, names]) =>
          finding('config.ports', 'E115', `${names.join(' and ')} both use ${String(port)}`),
        ),
    );
  },
};

export const routes: Check = {
  id: 'config.routes',
  title: 'no two remotes claim overlapping routes',
  run: ({ apps }) => {
    const claimed: { app: string; route: string }[] = [];
    const out = [];
    for (const app of apps) {
      if (app.kind !== 'remote' || app.mfe.state !== 'ok') continue;
      for (const route of app.mfe.value.routes) {
        for (const other of claimed) {
          if (other.app === app.name || !routesOverlap(route, other.route)) continue;
          out.push(
            finding(
              'config.routes',
              'E116',
              `${app.name} route ${route} overlaps ${other.app} route ${other.route}`,
              { app: app.name, path: app.appFile },
            ),
          );
        }
      }
      for (const route of app.mfe.value.routes) claimed.push({ app: app.name, route });
    }
    return done(out);
  },
};

const REGISTRY_IN_SHELL = 'the registry is in the shell repo';

export const registry: Check = {
  id: 'config.registry',
  title: 'every remote has a valid registry entry in dev, staging and prod',
  run: ({ apps, project, registry: entries }) => {
    // A remote's repo has no registry: the shell repo owns it, and its entries name remotes of other repos.
    if (project.repo === 'remote')
      return Promise.resolve({ findings: [], skipped: REGISTRY_IN_SHELL });
    const out = [];
    const remotes = apps.filter((app) => app.kind === 'remote');
    for (const env of ENVS) {
      for (const app of remotes) {
        const entry = entries[env]?.[app.name] ?? { state: 'missing' as const };
        const file = `registry/envs/${env}/${app.name}.json`;
        if (entry.state === 'missing') {
          out.push(
            finding('config.registry', 'E114', `${file} is missing`, {
              app: app.name,
              path: file,
              fixable: true,
            }),
          );
        } else if (entry.state === 'invalid') {
          out.push(
            finding('config.registry', 'E114', `${file}: ${issueText(entry)}`, {
              app: app.name,
              path: file,
            }),
          );
        }
      }
      const known = new Set(remotes.map((r) => r.name));
      for (const name of Object.keys(entries[env] ?? {})) {
        if (!known.has(name) && project.repo !== 'shell') {
          out.push(
            finding(
              'config.registry',
              'E114',
              `registry/envs/${env}/${name}.json has no remote in mfeflow.json`,
              {
                severity: 'warning',
                path: `registry/envs/${env}/${name}.json`,
              },
            ),
          );
        }
      }
    }
    return done(out);
  },
};

export const localCheckout: Check = {
  id: 'config.local',
  title: 'the linked mfeflow checkout is built',
  run: ({ project, root }) => {
    if (project.local === undefined)
      return Promise.resolve({ findings: [], skipped: 'not linked with --local' });
    try {
      const unbuilt = [...scanCheckout(path.resolve(root, project.local))]
        .filter(([, p]) => !p.built)
        .map(([name]) => name);
      return done(
        unbuilt.length === 0
          ? []
          : [
              finding(
                'config.local',
                'E110',
                `${unbuilt.join(', ')} not built in ${project.local}`,
              ),
            ],
      );
    } catch (error) {
      return done([
        finding('config.local', 'E110', error instanceof Error ? error.message : String(error)),
      ]);
    }
  },
};

export const drift: Check = {
  id: 'files.drift',
  title: 'copied files match the hashes in mfeflow.json',
  run: async ({ root, project }) => ({
    findings: (await findDiverged(root, project)).map((file) =>
      finding('files.drift', 'E117', `${file.path} is ${file.state}`, {
        severity: 'warning',
        path: file.path,
      }),
    ),
  }),
};

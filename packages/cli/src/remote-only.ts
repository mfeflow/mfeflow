import type { LoadedFeature, MfeflowProject } from '@mfeflow/core';
import { polyrepoCore } from './polyrepo';

/** A repo of remotes: the shell is deployed from another repo, so the routes and the registry live there. */
export const isRemoteRepo = (project: Pick<MfeflowProject, 'repo'>): boolean =>
  project.repo === 'remote';

/**
 * What adding a remote writes beyond its own app: nothing in a remote repo, whose routes and registry
 * entries belong to the shell's repo; a registry entry and a route in the shell elsewhere.
 */
export function glueScope(project: Pick<MfeflowProject, 'repo'>): {
  registry: boolean;
  shells: string[];
} {
  return isRemoteRepo(project)
    ? { registry: false, shells: [] }
    : { registry: true, shells: ['shell'] };
}

/** `core` as a repo of remotes gets it: no registry folders, and the README and AGENTS.md come from `remote-only`. */
export function coreFor(project: Pick<MfeflowProject, 'repo' | 'scope'>, core: LoadedFeature) {
  if (!isRemoteRepo(project)) return Promise.resolve(core);
  return polyrepoCore(core, {
    kind: 'remote',
    scope: project.scope,
    remote: { name: 'remotes', port: 0 },
  });
}

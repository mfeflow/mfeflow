import { createLinks, type LinkConfig, type Links } from '@mfeflow/route-factory';
import { routeSets } from './routes';

export * from '@mfeflow/route-factory';
export { accountRoutes, routeSets } from './routes';

/** Typed links over the company's `routeSets`. `config.base` is where the shell is served. */
export function createCompanyLinks(config: LinkConfig = {}): Links<typeof routeSets> {
  return createLinks(routeSets, config);
}

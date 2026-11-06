export const ENVIRONMENTS = ['dev', 'staging', 'prod'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/**
 * Where the registry index is served, per environment, primary first: the shell tries them in order and uses the
 * first that answers. A same-origin path (`/registry/index.json`) or a full URL. Fill these in.
 */
export const registryUrls: Readonly<Record<Environment, readonly string[]>> = Object.freeze({
  dev: Object.freeze([]),
  staging: Object.freeze([]),
  prod: Object.freeze([]),
});

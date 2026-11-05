import { DENY_ALL, type ConsentUpdate } from '@mfeflow/analytics';

export const ENVIRONMENTS = ['dev', 'staging', 'prod'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/** Consent before the visitor chooses: every signal denied until they grant it. */
export const consentDefaults: Readonly<ConsentUpdate> = Object.freeze({ ...DENY_ALL });

/** The Tag Manager container (GTM-XXXXXXX) of each environment. Fill these in. */
export const containerIds: Readonly<Record<Environment, string>> = Object.freeze({
  dev: '',
  staging: '',
  prod: '',
});

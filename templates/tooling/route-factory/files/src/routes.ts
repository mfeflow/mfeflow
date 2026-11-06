import { defineRoutes } from '@mfeflow/route-factory';

// One set per remote: where the shell serves it and the routes under that. Replace this one with yours.
export const accountRoutes = defineRoutes('/account', {
  home: '/',
  settings: '/settings',
  invoice: '/invoices/:id',
});

/** Every remote's routes, by the name used in a link id: `account.invoice`. */
export const routeSets = { account: accountRoutes };

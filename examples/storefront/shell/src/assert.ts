import { checkSingletons } from '@mfeflow/runtime';

const SINGLETONS = [
  'react',
  'react-dom',
  'i18next',
  'react-i18next',
  '@mfeflow/runtime',
  '@mfeflow/event-bus',
  '@mfeflow/storage',
  '@mfeflow/theme',
  '@mfeflow/i18n',
];

declare global {
  var mfeflowCheckSingletons: (() => ReturnType<typeof checkSingletons>) | undefined;
}

// Loaded only in development and on `?mfeflow-assert`: it reads every loaded remote's share scope.
globalThis.mfeflowCheckSingletons = () => checkSingletons(SINGLETONS);

import { renderWithPlatform, type PlatformRenderOptions } from '@mfeflow/testing';
import { defaultProviders } from './defaults';

export * from '@mfeflow/testing';
export { defaultProviders } from './defaults';

/** `renderWithPlatform` in the company's `defaultProviders`; pass `providers` to use another list. */
export function renderWithCompany(
  ui: Parameters<typeof renderWithPlatform>[0],
  options: PlatformRenderOptions = {},
): ReturnType<typeof renderWithPlatform> {
  return renderWithPlatform(ui, { providers: defaultProviders, ...options });
}

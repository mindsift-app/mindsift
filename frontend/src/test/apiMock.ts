import type * as ApiModule from '../lib/api';
import { ApiError } from '../lib/api/client';

// lib/api in tests, for vi.mock's factory. The factory runs before the test file's own imports are ready,
// so it imports this module itself:
//
//   vi.mock('../../../lib/api', async (original) =>
//     (await import('../../../test/apiMock')).withApi(original, { revealSecret: vi.fn() }));
//
//   vi.mock('../../../lib/api', async () => (await import('../../../test/apiMock')).stubApi({ login }));

type Api = typeof ApiModule.api;
/** Methods of `api` replaced in a test (vi.fn() or a function of the test's own). */
export type ApiMethods = { [K in keyof Api]?: unknown };
type Module = typeof ApiModule;

/** The real lib/api with some `api` methods replaced; `extra` replaces other exports (isDesktopApp, …). */
export async function withApi(original: () => Promise<Module>, methods: ApiMethods = {}, extra: Partial<Record<keyof Module, unknown>> = {}) {
  const actual = await original();
  return { ...actual, ...extra, api: { ...actual.api, ...methods } };
}

/**
 * lib/api without the real module: only the given `api` methods, plus what nearly every view imports
 * besides (ApiError, no haptics, server mode, a user id). `extra` adds or replaces exports.
 */
export function stubApi(methods: ApiMethods = {}, extra: Partial<Record<keyof Module, unknown>> = {}) {
  return {
    api: methods,
    ApiError,
    triggerHaptic: () => {},
    isDesktopApp: () => false,
    getCurrentUserId: () => 'u1',
    ...extra,
  };
}

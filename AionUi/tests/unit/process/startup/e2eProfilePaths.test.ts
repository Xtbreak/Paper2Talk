/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { getConfigPath, getDataPath } from '@/process/utils/utils';

const { getHomeDir } = vi.hoisted(() => ({
  getHomeDir: vi.fn((): string => {
    throw new Error('E2E path resolution accessed the home alias location');
  }),
}));

vi.mock('@/common/platform', () => ({
  getPlatformServices: () => ({
    paths: {
      isPackaged: () => false,
      needsCliSafeSymlinks: () => true,
      getDataDir: () => process.env.AIONUI_E2E_USER_DATA_DIR,
      getHomeDir,
    },
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

it('uses E2E profile paths without accessing user home symlinks', () => {
  const profile = path.resolve('disposable-profile');
  vi.stubEnv('AIONUI_E2E_TEST', '1');
  vi.stubEnv('AIONUI_E2E_USER_DATA_DIR', profile);

  expect(getDataPath()).toBe(path.join(profile, 'aionui'));
  expect(getConfigPath()).toBe(path.join(profile, 'config'));
  expect(getHomeDir).not.toHaveBeenCalled();
});

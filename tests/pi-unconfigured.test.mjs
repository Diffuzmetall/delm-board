import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefaultResourceLoader, SettingsManager } from '@earendil-works/pi-coding-agent';
import { boardFixture } from './fixture.mjs';

test('installed Pi entry is inert when no run is selected', async () => {
  const f = await boardFixture();
  try {
    const agentDir = join(f.directory, 'unconfigured-profile');
    await mkdir(agentDir);
    const loader = new DefaultResourceLoader({
      cwd: f.workspace, agentDir, settingsManager: SettingsManager.inMemory({}),
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      additionalExtensionPaths: [fileURLToPath(new URL('../adapters/durable/pi.mjs', import.meta.url))],
    });
    await loader.reload();
    const loaded = loader.getExtensions();
    assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.length, 1);
    assert.equal(loaded.extensions[0].tools.size, 0);
  } finally { await f.close(); }
});

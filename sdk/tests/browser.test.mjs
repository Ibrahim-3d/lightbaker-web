import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { startMockService } from '../examples/mock-service.mjs';
import { referenceScene } from '../examples/scene-package.mjs';

test('browser ESM import, cross-origin File submission, progress, Blob download and abort', async () => {
  const assets = await startMockService(), api = await startMockService();
  let browser;
  try {
    browser = await chromium.launch({ ...(existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(`${assets.endpoint}browser`);
    const outcome = await page.evaluate(async ({ endpoint, bytes }) => {
      const { LightBakerClient, LightBakerError } = await import('/sdk/index.js');
      const client = new LightBakerClient({ endpoint });
      const job = await client.bakeScene({ file: new File([new Uint8Array(bytes)], 'room.glb', { type: 'model/gltf-binary' }) });
      const progress = [];
      const result = await client.wait(job.id, { pollIntervalMs: 1, onProgress: value => progress.push(value.progress) });
      const blob = await client.downloadArtifact(result.artifacts[1]);
      const image = document.createElement('img');
      image.src = URL.createObjectURL(blob); await image.decode(); URL.revokeObjectURL(image.src);
      const controller = new AbortController(); controller.abort();
      let code;
      try { await client.getJob(job.id, { signal: controller.signal }); } catch (error) { if (error instanceof LightBakerError) code = error.code; }
      return { status: result.job.status, progress, type: blob.type, width: image.naturalWidth, code, hasGPU: 'gpu' in navigator };
    }, { endpoint: api.endpoint, bytes: [...referenceScene()] });
    assert.equal(outcome.status, 'completed'); assert.deepEqual(outcome.progress, [10,100]);
    assert.equal(outcome.type, 'image/png'); assert.equal(outcome.width, 1); assert.equal(outcome.code, 'ABORTED');
  } finally { await browser?.close(); await api.close(); await assets.close(); }
});

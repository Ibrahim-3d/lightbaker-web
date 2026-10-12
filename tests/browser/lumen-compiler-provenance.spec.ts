import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const compiler = process.env.LUMEN_COMPILER_CLI;
test.skip(!compiler, 'Set LUMEN_COMPILER_CLI to run the local cross-repository compiler handshake');

test('actual Lumen compiler fingerprints match and reject a changed Studio source', async ({ page }) => {
  await page.goto('/?test=1');
  await expect(page.locator('[data-scene-node-kind="mesh"]').first()).toBeVisible();
  const source = Buffer.from(await page.evaluate(async () => {
    const { exportLumenGeometry } = await import('/src/contract.ts');
    return Array.from(new Uint8Array(await exportLumenGeometry((window as any).__studio.roots())));
  }));
  const temporary = await mkdtemp(join(tmpdir(), 'lumen-studio-provenance-'));
  try {
    const input = join(temporary, 'source.glb');
    const output = join(temporary, 'package');
    await writeFile(input, source);
    await run(process.execPath, [compiler!, input, output, ...(process.env.LUMEN_KTX_PATH ? ['--ktx', process.env.LUMEN_KTX_PATH] : [])], { cwd: dirname(dirname(compiler!)), maxBuffer: 2 * 1024 * 1024 });
    const manifest = await readFile(join(output, 'scene.json'));
    const geometry = await readFile(join(output, 'geometry.glb'));
    const record = JSON.parse(manifest.toString());
    expect(record.source).toEqual({ byteLength: source.length, sha256: createHash('sha256').update(source).digest('hex') });
    expect(record.geometry.sha256).toBe(createHash('sha256').update(geometry).digest('hex'));
    const check = await page.evaluate(async ({ manifestBytes, geometryBytes, sourceBytes }) => {
      const { validateCompiledSourceSelection } = await import('/src/lumen-delivery.ts');
      return validateCompiledSourceSelection(new Uint8Array(manifestBytes).buffer, new Uint8Array(geometryBytes).buffer, new Uint8Array(sourceBytes).buffer);
    }, { manifestBytes: Array.from(manifest), geometryBytes: Array.from(geometry), sourceBytes: Array.from(source) });
    expect(check).toEqual({ sourceSha256: record.source.sha256, geometrySha256: record.geometry.sha256 });
    const stale = await page.evaluate(async ({ manifestBytes, geometryBytes }) => {
      const { validateCompiledSourceSelection } = await import('/src/lumen-delivery.ts');
      const { exportLumenGeometry } = await import('/src/contract.ts');
      (window as any).__studio.roots()[0].position.x += 1;
      try {
        await validateCompiledSourceSelection(new Uint8Array(manifestBytes).buffer, new Uint8Array(geometryBytes).buffer,
          await exportLumenGeometry((window as any).__studio.roots()));
        return false;
      } catch { return true; }
    }, { manifestBytes: Array.from(manifest), geometryBytes: Array.from(geometry) });
    expect(stale).toBe(true);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

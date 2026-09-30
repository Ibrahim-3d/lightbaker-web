import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectScenePackage, LightBakerError } from '../dist/index.js';
import { encodeGLB, referenceScene } from '../examples/scene-package.mjs';
const invalid = error => error instanceof LightBakerError && error.code === 'INVALID_SCENE';

test('GLB inspection supports File/Blob, buffers, DataView/byte offsets and scene versions', async () => {
  for (const version of [1,2]) {
    const bytes = referenceScene(version);
    for (const input of [bytes, Buffer.from(bytes), bytes.buffer, new DataView(bytes.buffer), new Blob([bytes]), { file: new File([bytes], 'scene.glb') }])
      assert.deepEqual(await inspectScenePackage(input), { byteLength: bytes.length, sceneContractVersion: version });
  }
});
test('unannotated GLB is allowed for the legacy API with version reported unknown', async () => {
  assert.equal((await inspectScenePackage(encodeGLB({ asset: { version: '2.0' } }))).sceneContractVersion, null);
});
test('bad GLB envelopes and malformed JSON are rejected', async () => {
  const mutations = [bytes => bytes.slice(0,12), bytes => { bytes[0] = 0; return bytes; },
    bytes => { new DataView(bytes.buffer).setUint32(4,1,true); return bytes; },
    bytes => bytes.slice(0,-4), bytes => { new DataView(bytes.buffer).setUint32(12,0xffffffff,true); return bytes; },
    bytes => { new DataView(bytes.buffer).setUint32(16,0,true); return bytes; },
    bytes => { bytes[20] = 0xff; return bytes; }];
  for (const mutate of mutations) await assert.rejects(inspectScenePackage(mutate(referenceScene())), invalid);
  for (const document of [null, {}, { asset: { version: '1.0' } }, { asset: { version: '2.0' }, scenes: [] },
    { asset: { version: '2.0' }, scene: -1, scenes: [{}] }])
    await assert.rejects(inspectScenePackage(encodeGLB(document)), invalid);
});
test('external asset packages and invalid metadata are rejected before transport', async () => {
  for (const fields of [{ buffers: [{ uri: '../secret.bin' }] }, { images: [{ uri: 'https://images.test/tex.png' }] },
    { images: [null] }, { buffers: {} }, { scenes: [{ extras: { lightbaker: { version: 3 } } }] },
    { scenes: [{ extras: { lightbaker: { version: 2 } } }] }])
    await assert.rejects(inspectScenePackage(encodeGLB({ asset: { version: '2.0' }, ...fields })), invalid);
  await inspectScenePackage(encodeGLB({ asset: { version: '2.0' }, images: [{ uri: 'data:image/png;base64,AA==' }] }));
  await assert.rejects(inspectScenePackage({ children: [] }), invalid);
});
test('public setting bounds reject instead of silently clamping', async () => {
  const good = { version: 2, world: { color: '#17191d', intensity: 0.15 },
    bake: { resolution: 256, samples: 16, bounces: 2, denoise: true } };
  for (const metadata of [{ ...good, world: { ...good.world, color: 'red' } }, { ...good, world: { ...good.world, intensity: 5 } },
    ...['resolution','samples','bounces'].map(field => ({ ...good, bake: { ...good.bake, [field]: -1 } })),
    { ...good, bake: { ...good.bake, samples: 4.5 } }, { ...good, bake: { ...good.bake, denoise: 1 } }])
    await assert.rejects(inspectScenePackage(encodeGLB({ asset: { version: '2.0' }, scenes: [{ extras: { lightbaker: metadata } }] })), invalid);
});

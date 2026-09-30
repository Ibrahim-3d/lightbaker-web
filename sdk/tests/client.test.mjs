import test from 'node:test';
import assert from 'node:assert/strict';
import { LightBakerClient, LightBakerError, LightBakerHttpError, LightBakerJobError } from '../dist/index.js';
import { referenceScene } from '../examples/scene-package.mjs';
import { startMockService } from '../examples/mock-service.mjs';

const endpoint = 'https://api.example.test/base/';
const job = { id: 'job-1', status: 'running', progress: 10 };
const artifact = { kind: 'lightmap', name: 'lightmap.png', url: 'artifacts/job-1/lightmap.png' };
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const makeClient = fetch => new LightBakerClient({ endpoint, fetch });
const errorCode = code => error => error instanceof LightBakerError && error.code === code;

test('current API: raw GLB, query preset, status/progress, discovery and bytes over HTTP', async () => {
  const requests = [];
  const mock = await startMockService({ root: '/base/', onRequest: request => requests.push(request) });
  try {
    const client = new LightBakerClient({ endpoint: mock.endpoint });
    assert.deepEqual(await client.getCapabilities(), { apiVersion: '1', source: 'legacy', sceneContractVersions: null,
      formats: ['glb'], cancellation: false, maxSceneBytes: 26214400, features: null });
    const bytes = referenceScene();
    const submitted = await client.bakeScene({ file: new File([bytes], 'studio.glb') }, { quality: 'production' });
    assert.equal(submitted.status, 'queued');
    assert.equal(requests[0].path, '/base/bakeScene');
    assert.equal(requests[0].query, '?quality=production');
    assert.equal(requests[0].headers['content-type'], 'model/gltf-binary');
    assert.deepEqual(new Uint8Array(requests[0].bytes), bytes);
    assert.deepEqual(await client.getArtifacts(submitted.id), []);
    const progress = [];
    const result = await client.wait(submitted.id, { pollIntervalMs: 1, onProgress: value => progress.push(value) });
    assert.deepEqual(progress.map(x => x.status), ['running', 'completed']);
    assert.deepEqual(progress.map(x => x.progress), [10,100]);
    assert.equal(result.job.status, 'completed');
    assert.deepEqual(result.artifacts.map(x => x.kind), ['preview','lightmap']);
    const blob = await client.downloadArtifact(result.artifacts[1]);
    assert.equal(blob.type, 'image/png');
    assert.deepEqual([...new Uint8Array(await blob.arrayBuffer()).slice(0,8)], [137,80,78,71,13,10,26,10]);
    await assert.rejects(client.cancel(submitted.id), errorCode('UNSUPPORTED_CAPABILITY'));
    assert.equal(requests.some(x => /capabilities|cancelJob/.test(x.path)), false);
    await assert.rejects(client.getJob('missing-id'), error => error instanceof LightBakerHttpError && error.status === 404);
  } finally { await mock.close(); }
});

test('mutable byte views snapshot before asynchronous submission and honor offset', async () => {
  const scene = referenceScene(), storage = new Uint8Array(scene.length + 16);
  storage.set(scene, 8);
  let uploaded;
  const client = makeClient(async (_, init) => { uploaded = new Uint8Array(await init.body.arrayBuffer()); return response(job); });
  const pending = client.bakeScene(storage.subarray(8, 8 + scene.length));
  storage.fill(0);
  await pending;
  assert.deepEqual(uploaded, scene);
});

test('explicit discovery negotiates/caches versions and gates cancellation', async () => {
  const requests = [], mock = await startMockService({ discovery: true, cancellation: true, onRequest: request => requests.push(request) });
  try {
    const client = new LightBakerClient({ endpoint: mock.endpoint, capabilitiesUrl: 'capabilities' });
    const caps = await client.getCapabilities();
    assert.equal(caps.source, 'negotiated'); assert.equal(caps.cancellation, true);
    assert.deepEqual(caps.sceneContractVersions, [1,2]); assert.ok(Object.isFrozen(caps.sceneContractVersions));
    const submitted = await client.bakeScene(referenceScene());
    assert.equal((await client.cancel(submitted.id)).status, 'cancelled');
    await assert.rejects(client.wait(submitted.id), error => error instanceof LightBakerJobError && error.code === 'JOB_CANCELLED');
    assert.equal(requests.filter(x => x.path === '/capabilities').length, 1);
    assert.equal(requests.find(x => x.path.startsWith('/cancelJob')).method, 'POST');
  } finally { await mock.close(); }
});

test('discovery failure, incompatible versions and malformed documents never silently downgrade', async () => {
  for (const [document, code] of [
    [{ apiVersions: ['2'], sceneContractVersions: [2], formats: ['glb'], cancellation: false }, 'INCOMPATIBLE_VERSION'],
    [{ apiVersions: ['1'], sceneContractVersions: [3], formats: ['glb'], cancellation: false }, 'INCOMPATIBLE_VERSION'],
    [{ apiVersions: ['1'], sceneContractVersions: [2], formats: ['obj'], cancellation: false }, 'INCOMPATIBLE_VERSION'],
    [{ apiVersions: ['1'], sceneContractVersions: [2], formats: ['glb'], cancellation: 'yes' }, 'PROTOCOL_ERROR'],
    [{ apiVersions: ['1'], sceneContractVersions: [2], formats: ['glb'], cancellation: false, maxSceneBytes: -1 }, 'PROTOCOL_ERROR'],
  ]) {
    const client = new LightBakerClient({ endpoint, capabilitiesUrl: 'capabilities', fetch: async () => response(document) });
    await assert.rejects(client.getCapabilities(), errorCode(code));
  }
  let calls = 0;
  const client = new LightBakerClient({ endpoint, capabilitiesUrl: 'capabilities', fetch: async () => {
    calls++; return new Response('missing', { status: 404 });
  } });
  await assert.rejects(client.bakeScene(referenceScene()), errorCode('HTTP_ERROR'));
  assert.equal(calls, 1);
});

test('negotiated scene versions and size limits prevent POST', async () => {
  let posts = 0;
  const client = new LightBakerClient({ endpoint, capabilitiesUrl: 'capabilities', fetch: async (_, init) => {
    if (init.method === 'POST') posts++;
    return response({ apiVersions: ['1'], sceneContractVersions: [2], formats: ['glb'], cancellation: false });
  } });
  await assert.rejects(client.bakeScene(referenceScene(1)), errorCode('INCOMPATIBLE_VERSION'));
  assert.equal(posts, 0);
  const small = new LightBakerClient({ endpoint, capabilitiesUrl: 'capabilities', fetch: async () => response({
    apiVersions: ['1'], sceneContractVersions: [2], formats: ['glb'], cancellation: false, maxSceneBytes: 100,
  }) });
  await assert.rejects(small.bakeScene(referenceScene()), errorCode('INVALID_SCENE'));
});

test('failed and cancelled jobs are typed terminal errors without artifact fetch', async () => {
  for (const status of ['failed','cancelled']) {
    let calls = 0;
    const client = makeClient(async () => { calls++; return response({ ...job, status, error: 'Bake unavailable' }); });
    await assert.rejects(client.wait(job.id), error => error instanceof LightBakerJobError && error.job.id === job.id && error.message === 'Bake unavailable');
    assert.equal(calls, 1);
  }
});

test('callback cannot mutate job identity or manufacture completion', async () => {
  let polls = 0;
  const client = makeClient(async url => url.includes('getArtifacts') ? response([artifact])
    : response({ ...job, status: ++polls === 1 ? 'running' : 'completed' }));
  const result = await client.wait(job.id, { pollIntervalMs: 1, onProgress: value => { value.id = 'other'; value.status = 'failed'; } });
  assert.equal(result.job.id, job.id); assert.equal(result.job.status, 'completed');
});

test('callback exceptions propagate and stop polling', async () => {
  const failure = new Error('consumer failed'); let calls = 0;
  await assert.rejects(makeClient(async () => { calls++; return response(job); }).wait(job.id, {
    onProgress: () => { throw failure; },
  }), error => error === failure);
  assert.equal(calls, 1);
});

test('local abort stops polling without remote cancellation', async () => {
  const controller = new AbortController(); const paths = [];
  const client = makeClient(async url => { paths.push(url); return response(job); });
  await assert.rejects(client.wait(job.id, { signal: controller.signal, onProgress: () => controller.abort() }), errorCode('ABORTED'));
  assert.equal(paths.length, 1);
  const already = new AbortController(); already.abort();
  await assert.rejects(client.bakeScene(referenceScene(), { signal: already.signal }), errorCode('ABORTED'));
  await assert.rejects(client.getCapabilities({ signal: already.signal }), errorCode('ABORTED'));
});

test('abort during poll delay clears the timer and prevents another request', async () => {
  const controller = new AbortController(); let calls = 0;
  const client = makeClient(async () => { calls++; return response(job); });
  const pending = client.wait(job.id, { signal: controller.signal, pollIntervalMs: 60_000 });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, errorCode('ABORTED')); assert.equal(calls, 1);
});

test('total deadline covers hung requests and artifact retrieval', async () => {
  const client = makeClient(async () => new Promise(() => {}));
  await assert.rejects(client.wait(job.id, { timeoutMs: 10 }), errorCode('TIMEOUT'));
  const artifactHang = makeClient(async url => url.includes('getArtifacts') ? new Promise(() => {}) : response({ ...job, status: 'completed' }));
  await assert.rejects(artifactHang.wait(job.id, { timeoutMs: 10 }), errorCode('TIMEOUT'));
});

test('individual request timeout, upload abort and download timeout', async () => {
  const fetcher = async () => new Promise(() => {});
  const client = new LightBakerClient({ endpoint, fetch: fetcher, requestTimeoutMs: 10 });
  await assert.rejects(client.getJob(job.id), errorCode('TIMEOUT'));
  await assert.rejects(client.bakeScene(referenceScene()), errorCode('TIMEOUT'));
  await assert.rejects(client.downloadArtifact(artifact), errorCode('TIMEOUT'));
  const controller = new AbortController();
  const pending = client.bakeScene(referenceScene(), { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, errorCode('ABORTED'));
});

test('submission errors never trigger automatic retries', async () => {
  let calls = 0;
  const client = makeClient(async () => { calls++; throw new TypeError('connection dropped'); });
  await assert.rejects(client.bakeScene(referenceScene()), errorCode('NETWORK_ERROR'));
  assert.equal(calls, 1);
});

test('HTTP errors retain typed status and service detail; non-JSON errors are supported', async () => {
  await assert.rejects(makeClient(async () => new Response(JSON.stringify({ error: 'Upload too large' }), { status: 413 })).bakeScene(referenceScene()),
    error => error instanceof LightBakerHttpError && error.status === 413 && error.message.includes('Upload too large'));
  await assert.rejects(makeClient(async () => new Response('<html>Unavailable</html>', { status: 503 })).getJob(job.id),
    error => error instanceof LightBakerHttpError && error.status === 503);
});

test('malformed successful JSON and invalid job responses fail closed', async () => {
  await assert.rejects(makeClient(async () => new Response('not json')).getJob(job.id), errorCode('PROTOCOL_ERROR'));
  for (const invalid of [null, {}, { ...job, id: 'other' }, { ...job, status: 'working' }, { ...job, status: ['running'] }, { ...job, progress: -1 },
    { ...job, progress: 101 }, { ...job, progress: '10' }, { ...job, error: {} }])
    await assert.rejects(makeClient(async () => response(invalid)).getJob(job.id), errorCode('PROTOCOL_ERROR'));
  assert.equal((await makeClient(async () => response({ id: job.id, status: 'running' })).getJob(job.id)).progress, undefined);
});

test('artifact validation, relative URLs, unknown future kinds and completed-without-artifacts', async () => {
  for (const invalid of [{}, [null], [{ ...artifact, url: 'javascript:alert(1)' }], [{ ...artifact, url: 'https://user:secret@example.com' }],
    [{ ...artifact, mediaType: 42 }]])
    await assert.rejects(makeClient(async () => response(invalid)).getArtifacts(job.id), errorCode('PROTOCOL_ERROR'));
  const artifacts = await makeClient(async () => response([{ ...artifact, kind: 'manifest' }])).getArtifacts(job.id);
  assert.equal(artifacts[0].url, `${endpoint}artifacts/job-1/lightmap.png`);
  assert.equal(artifacts[0].kind, 'manifest'); assert.equal(artifacts[0].mediaType, undefined);
  const empty = makeClient(async url => response(url.includes('getJob') ? { ...job, status: 'completed' } : []));
  await assert.rejects(empty.wait(job.id), errorCode('PROTOCOL_ERROR'));
});

test('external artifact downloads omit credentials and validate schemes', async () => {
  const client = makeClient(async (url, init) => {
    assert.equal(url, 'https://cdn.example.test/lightmap.png'); assert.equal(init.credentials, 'omit');
    assert.equal(init.headers, undefined); return new Response(new Uint8Array([1,2,3]));
  });
  assert.equal((await client.downloadArtifact({ ...artifact, url: 'https://cdn.example.test/lightmap.png' })).size, 3);
  await assert.rejects(client.downloadArtifact({ ...artifact, url: 'file:///etc/passwd' }), errorCode('INVALID_ARGUMENT'));
  await assert.rejects(client.downloadArtifact({}), errorCode('INVALID_ARGUMENT'));
});

test('invalid endpoint, identifiers and durations are rejected before network work', async () => {
  for (const value of ['', 'file:///tmp/sdk', 'https://user:pass@example.com', 'https://example.com?q=1', 'https://example.com#fragment'])
    assert.throws(() => new LightBakerClient({ endpoint: value }), errorCode('INVALID_ARGUMENT'));
  assert.throws(() => new LightBakerClient({ endpoint, capabilitiesUrl: 'https://other.test/capabilities' }), errorCode('INVALID_ARGUMENT'));
  assert.throws(() => new LightBakerClient({ endpoint, requestTimeoutMs: Infinity }), errorCode('INVALID_ARGUMENT'));
  const client = makeClient(async () => { throw new Error('must not call'); });
  for (const id of ['', '..', '../other', 'id?query', 'id/child']) await assert.rejects(client.getJob(id), errorCode('INVALID_ARGUMENT'));
  await assert.rejects(client.wait(job.id, { timeoutMs: 0 }), errorCode('INVALID_ARGUMENT'));
  await assert.rejects(client.wait(job.id, { pollIntervalMs: NaN }), errorCode('INVALID_ARGUMENT'));
});

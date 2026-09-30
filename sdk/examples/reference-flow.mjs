import { LightBakerClient } from '../dist/index.js';
import { referenceScene } from './scene-package.mjs';
import { startMockService } from './mock-service.mjs';

const mock = await startMockService();
try {
  const client = new LightBakerClient({ endpoint: mock.endpoint });
  const job = await client.bakeScene(referenceScene());
  const result = await client.wait(job.id, { pollIntervalMs: 20, onProgress: job => console.log(job.status, job.progress) });
  const lightmap = result.artifacts.find(artifact => artifact.kind === 'lightmap');
  const bytes = await client.downloadArtifact(lightmap);
  console.log({ jobId: result.job.id, artifacts: result.artifacts.length, downloadedBytes: bytes.size });
  console.log('Mock transport flow complete. Placeholder PNGs are not rendered lighting.');
} finally { await mock.close(); }

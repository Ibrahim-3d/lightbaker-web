import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** Transport reference, not a baker. Artifact bytes are explicitly placeholder PNGs. */
export async function startMockService({ cancellation = false, discovery = false, root = '/', onRequest } = {}) {
  const jobs = new Map();
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhxoAAAAASUVORK5CYII=', 'base64');
  const server = createServer(async (req, res) => {
    try {
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', 'content-type');
      res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      const url = new URL(req.url, 'http://localhost');
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      onRequest?.({ method: req.method, path: url.pathname, query: url.search, headers: req.headers, bytes });
      const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (url.pathname.startsWith('/sdk/') && /^\/sdk\/[a-z]+\.js$/.test(url.pathname)) {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end(await readFile(new URL(`../dist/${url.pathname.slice(5)}`, import.meta.url))); return;
      }
      if (url.pathname === '/browser') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>SDK browser contract</title>'); return; }
      const route = url.pathname.startsWith(root) ? url.pathname.slice(root.length) : '';
      if (route === 'capabilities' && discovery) {
        json(200, { apiVersions: ['1'], sceneContractVersions: [1,2], formats: ['glb'], cancellation,
          maxSceneBytes: 25 * 1024 * 1024, features: ['diffuse-lightmaps'] }); return;
      }
      if (route === 'bakeScene' && req.method === 'POST') {
        if (req.headers['content-type'] !== 'model/gltf-binary') { json(415, { error: 'Upload a GLB scene' }); return; }
        if (bytes.length < 20 || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2
          || bytes.readUInt32LE(8) !== bytes.length) { json(400, { error: 'Expected GLB 2.0' }); return; }
        const id = randomUUID(); jobs.set(id, { id, polls: 0, cancelled: false, bytes });
        json(202, { id, status: 'queued', progress: 0 }); return;
      }
      const [action, id, filename] = route.split('/');
      const job = jobs.get(id);
      if (!job) { json(404, { error: 'Job not found' }); return; }
      if (action === 'cancelJob' && req.method === 'POST' && cancellation && discovery) {
        job.cancelled = true; json(200, { id, status: 'cancelled', progress: 10 }); return;
      }
      if (action === 'getJob') {
        job.polls++;
        json(200, { id, status: job.cancelled ? 'cancelled' : job.polls < 2 ? 'running' : 'completed',
          progress: job.polls < 2 ? 10 : 100 }); return;
      }
      if (action === 'getArtifacts') {
        json(200, job.polls >= 2 && !job.cancelled ? [
          { kind: 'preview', name: 'baked-preview.png', url: `${endpoint}artifacts/${id}/preview.png` },
          { kind: 'lightmap', name: 'lightmap.png', url: `${endpoint}artifacts/${id}/lightmap.png` },
        ] : []); return;
      }
      if (action === 'artifacts' && ['preview.png','lightmap.png'].includes(filename) && job.polls >= 2 && !job.cancelled) {
        res.writeHead(200, { 'content-type': 'image/png' }); res.end(png); return;
      }
      json(404, { error: 'Not found' });
    } catch {
      res.writeHead(500); res.end('Mock service failure');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}${root}`;
  return { endpoint, jobs, close: () => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
  }) };
}

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0, 'SDK must have no runtime dependencies');
const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' }));
for (const { path } of pack.files) {
  assert.match(path, /^(dist\/|docs\/|README\.md$|LICENSE$|package\.json$)/, `Unexpected package file: ${path}`);
  if (path.startsWith('dist/')) {
    const content = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(content, /WGSL|GPUDevice|GPUBuffer|navigator\.gpu|three-mesh-bvh|xatlas|from ['"]three|\.wgsl|\.glsl/,
      `Renderer dependency/implementation marker in ${path}`);
  }
}
assert.ok(pack.files.some(file => file.path === 'dist/index.d.ts'));
console.log(`Package boundary passed: ${pack.files.length} allowlisted files, zero runtime dependencies.`);

import { test, expect } from "@playwright/test";
import { createHash } from 'node:crypto';

async function selectedPackage(page: import('@playwright/test').Page) {
  const source = Buffer.from(await page.evaluate(async () => {
    const { exportLumenGeometry } = await import('/src/contract.ts');
    return Array.from(new Uint8Array(await exportLumenGeometry((window as any).__studio.roots())));
  }));
  const digest = createHash('sha256').update(source).digest('hex');
  const manifest = Buffer.from(JSON.stringify({
    format: 'lumen-asset-scene', version: 1, units: 'meters',
    source: { byteLength: source.length, sha256: digest },
    geometry: { file: 'geometry.glb', byteLength: source.length, sha256: digest },
  }));
  return [
    { name: 'scene.json', mimeType: 'application/json', buffer: manifest },
    { name: 'geometry.glb', mimeType: 'model/gltf-binary', buffer: source },
  ];
}
test("Studio exposes a Lumen source handoff without presenting platform artifacts as sidecars", async ({ page }) => {
  await page.goto("/?test=1");
  await expect(page.locator('[data-scene-node-kind="mesh"]').first()).toBeVisible();
  await page.getByRole("button", { name: "Bake", exact: true }).click();
  await expect(page.getByText("Lumen geometry handoff")).toBeVisible();
  await expect(page.getByRole("button", { name: "Bake compiled geometry…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Build local walkthrough" })).toBeDisabled();
  await expect(page.getByText(/This prepared Lumen preview uses the actual runtime/)).toBeVisible();
  await expect(page.getByText(/Platform preview PNGs are not Lumen sidecars/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export Lumen source GLB" }).click();
  expect((await download).suggestedFilename()).toBe("lumen-geometry-source.glb");
});
test('local walkthrough routes missing UV1 through private preparation, then compiles, bakes and attaches', async ({ page }) => {
  await page.goto('/?test=1');
  await expect(page.locator('[data-scene-node-kind="mesh"]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Bake', exact: true }).click();
  await page.evaluate(async () => {
    (window as any).__studio.roots()[0].traverse((node: any) => {
      if (node.isMesh) node.geometry.deleteAttribute('uv1');
    });
    const { registerLumenDeliveryAdapter } = await import('/src/lumen-delivery.ts');
    (window as any).__localStages = [];
    const hash = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      x => x.toString(16).padStart(2, '0')).join('');
    registerLumenDeliveryAdapter({
      prepareSource: async ({ sourceGlb, atlasResolution }: { sourceGlb: ArrayBuffer; atlasResolution: number }) => {
        (window as any).__localStages.push('prepare');
        if (!Number.isSafeInteger(atlasResolution) || atlasResolution < 16)
          throw new Error('Atlas resolution missing');
        return sourceGlb; // Contract routing only; the private provider tests the real unwrap.
      },
      compile: async ({ sourceGlb }: { sourceGlb: ArrayBuffer }) => {
        (window as any).__localStages.push('compile');
        const sha256 = await hash(sourceGlb);
        const manifest = {
          format: 'lumen-asset-scene', version: 1, units: 'meters',
          source: { byteLength: sourceGlb.byteLength, sha256 },
          geometry: { file: 'geometry.glb', byteLength: sourceGlb.byteLength, sha256 },
        };
        return { jobId: 'local-test', manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)).buffer,
          compiledGlb: sourceGlb };
      },
      bake: async ({ compiledGlb, authoredGlb, sourceSha256, atlasResolution }: { compiledGlb: ArrayBuffer; authoredGlb: ArrayBuffer; sourceSha256: string; atlasResolution: number }) => {
        (window as any).__localStages.push('bake');
        if (atlasResolution !== 128) throw new Error('Local Lumen atlas selection was not passed to WebGPU bake');
        if (new DataView(authoredGlb).getUint32(0, true) !== 0x46546c67) throw new Error('authored input missing');
        return { transfer: {
          format: 'lightbaker-lumen-lighting-v2', geometrySha256: await hash(compiledGlb),
          geometryCorrespondence: 'compiled-glb-exact', lightingComponent: 'indirect-plus-baked-radiance', bakedRadianceIncluded: true,
          directLightingIncluded: false, encoding: 'linear-irradiance-f32-rgb',
          rowOrigin: 'uv-v-zero', uvChannel: 1, refined: true,
          atlases: [{ width: 1, height: 1, rgb: [0, 0, 0], bakedRadianceRgb: [0, 0, 0] }],
          bindings: [{ node: 0, mesh: 0, primitive: 0, atlas: 0, intensity: 1 }],
        }, directLighting: {
          format: 'lumen-direct-lighting', version: 1, geometrySha256: await hash(compiledGlb),
          sourceSha256, authoredGlbSha256: await hash(authoredGlb), lights: [],
        } };
      },
      attach: async ({ jobId, transfer, directLighting }: { jobId: string; transfer: any; directLighting: any }) => {
        (window as any).__localStages.push('attach');
        if (jobId !== 'local-test' || transfer.lightingComponent !== 'indirect-plus-baked-radiance' ||
            directLighting.format !== 'lumen-direct-lighting')
          throw new Error('incorrect attachment');
        return { walkthroughUrl: '/walkthrough/local-test/' };
      },
    });
  });
  await page.getByRole('button', { name: 'Build local walkthrough' }).click();
  await expect(page.getByRole('link', { name: 'Open local walkthrough' })).toHaveAttribute('href', /\/walkthrough\/local-test\/$/);
  expect(await page.evaluate(() => (window as any).__localStages)).toEqual(['prepare', 'compile', 'bake', 'attach']);
});
test('local walkthrough rejects a forged compiler geometry fingerprint before WebGPU bake', async ({ page }) => {
  await page.goto('/?test=1');
  await expect(page.locator('[data-scene-node-kind="mesh"]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Bake', exact: true }).click();
  await page.evaluate(async () => {
    const { registerLumenDeliveryAdapter } = await import('/src/lumen-delivery.ts');
    (window as any).__bakerCalled = false;
    (window as any).__discardedJob = null;
    registerLumenDeliveryAdapter({
      prepareSource: async ({ sourceGlb }: { sourceGlb: ArrayBuffer }) => sourceGlb,
      compile: async ({ sourceGlb }: { sourceGlb: ArrayBuffer }) => {
        const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', sourceGlb)),
          x => x.toString(16).padStart(2, '0')).join('');
        const manifest = {
          format: 'lumen-asset-scene', version: 1, units: 'meters',
          source: { byteLength: sourceGlb.byteLength, sha256 },
          geometry: { file: 'geometry.glb', byteLength: sourceGlb.byteLength, sha256: '0'.repeat(64) },
        };
        return { jobId: 'local-test', manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)).buffer,
          compiledGlb: sourceGlb };
      },
      bake: async () => { (window as any).__bakerCalled = true; return {}; },
      attach: async () => ({ walkthroughUrl: '/walkthrough/local-test/' }),
      discard: async ({ jobId }: { jobId: string }) => { (window as any).__discardedJob = jobId; },
    });
  });
  await page.getByRole('button', { name: 'Build local walkthrough' }).click();
  await expect(page.getByRole('alert')).toContainText('does not match');
  expect(await page.evaluate(() => (window as any).__bakerCalled)).toBe(false);
  expect(await page.evaluate(() => (window as any).__discardedJob)).toBe('local-test');
});
test('local walkthrough discards a package when Studio changes while attachment finishes', async ({ page }) => {
  await page.goto('/?test=1');
  await expect(page.locator('[data-scene-node-kind="mesh"]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Bake', exact: true }).click();
  await page.evaluate(async () => {
    const { registerLumenDeliveryAdapter } = await import('/src/lumen-delivery.ts');
    (window as any).__discardedJob = null;
    const hash = async (bytes: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
      x => x.toString(16).padStart(2, '0')).join('');
    registerLumenDeliveryAdapter({
      prepareSource: async ({ sourceGlb }: { sourceGlb: ArrayBuffer }) => sourceGlb,
      compile: async ({ sourceGlb }: { sourceGlb: ArrayBuffer }) => {
        const sha256 = await hash(sourceGlb);
        const manifest = {
          format: 'lumen-asset-scene', version: 1, units: 'meters',
          source: { byteLength: sourceGlb.byteLength, sha256 },
          geometry: { file: 'geometry.glb', byteLength: sourceGlb.byteLength, sha256 },
        };
        return { jobId: 'stale-test', manifestBytes: new TextEncoder().encode(JSON.stringify(manifest)).buffer,
          compiledGlb: sourceGlb };
      },
      bake: async ({ compiledGlb, authoredGlb, sourceSha256 }: { compiledGlb: ArrayBuffer; authoredGlb: ArrayBuffer; sourceSha256: string }) => ({
        transfer: {
          format: 'lightbaker-lumen-lighting-v2', geometrySha256: await hash(compiledGlb),
          geometryCorrespondence: 'compiled-glb-exact', lightingComponent: 'indirect-plus-baked-radiance', bakedRadianceIncluded: true,
          directLightingIncluded: false, encoding: 'linear-irradiance-f32-rgb',
          rowOrigin: 'uv-v-zero', uvChannel: 1, refined: true,
          atlases: [{ width: 1, height: 1, rgb: [0, 0, 0], bakedRadianceRgb: [0, 0, 0] }],
          bindings: [{ node: 0, mesh: 0, primitive: 0, atlas: 0, intensity: 1 }],
        },
        directLighting: { format: 'lumen-direct-lighting', version: 1,
          geometrySha256: await hash(compiledGlb), sourceSha256,
          authoredGlbSha256: await hash(authoredGlb), lights: [] },
      }),
      attach: async () => {
        await new Promise<void>(resolve => { (window as any).__finishLocalAttach = resolve; });
        return { walkthroughUrl: '/walkthrough/stale-test/' };
      },
      discard: async ({ jobId }: { jobId: string }) => { (window as any).__discardedJob = jobId; },
    });
  });
  await page.getByRole('button', { name: 'Build local walkthrough' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishLocalAttach)).toBe('function');
  await page.evaluate(() => {
    const studio = (window as any).__studio;
    let mesh: any;
    studio.roots()[0].traverse((node: any) => { if (!mesh && node.isMesh) mesh = node; });
    const position = mesh.geometry.getAttribute('position');
    position.setX(0, position.getX(0) + 0.125);
    position.needsUpdate = true;
    (window as any).__finishLocalAttach();
  });
  await expect(page.getByRole('alert')).toContainText('scene changed during Lumen delivery');
  await expect(page.getByRole('link', { name: 'Open local walkthrough' })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__discardedJob)).toBe('stale-test');
});
test("private adapter receives exact compiled bytes and authored GLB before transfer download", async ({ page }) => {
  await page.goto("/?test=1");
  await expect(page.locator('[data-scene-node-kind="mesh"]').first()).toBeVisible();
  await page.getByRole("button", { name: "Bake", exact: true }).click();
  await page.evaluate(async () => {
    const { registerLumenDeliveryAdapter } = await import('/src/lumen-delivery.ts');
    registerLumenDeliveryAdapter({
      bake: async ({ compiledGlb, authoredGlb, atlasResolution }: { compiledGlb: ArrayBuffer; authoredGlb: ArrayBuffer; atlasResolution?: number }) => {
        if (new DataView(compiledGlb).getUint32(0, true) !== 0x46546c67 ||
            new DataView(authoredGlb).getUint32(0, true) !== 0x46546c67)
          throw new Error('Adapter input did not preserve compiled bytes and authored GLB');
        if (atlasResolution !== undefined)
          throw new Error('Offline transfer unexpectedly used the local Lumen atlas setting');
        const digest = await crypto.subtle.digest('SHA-256', compiledGlb);
        return {
          format: 'lightbaker-lumen-lighting-v2',
          geometrySha256: Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join(''),
          geometryCorrespondence: 'compiled-glb-exact', lightingComponent: 'indirect-plus-baked-radiance', bakedRadianceIncluded: true,
          directLightingIncluded: false, encoding: 'linear-irradiance-f32-rgb',
          rowOrigin: 'uv-v-zero', uvChannel: 1, refined: true,
          atlases: [{ width: 1, height: 1, rgb: [0, 0, 0], bakedRadianceRgb: [0, 0, 0] }],
          bindings: [{ node: 0, mesh: 0, primitive: 0, atlas: 0, intensity: 1 }],
        };
      },
    });
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Bake compiled geometry…' }).click();
  const downloadPromise = page.waitForEvent('download');
  await (await chooser).setFiles(await selectedPackage(page));
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('lumen-indirect-transfer.json');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('Studio rejects a tampered compiler source fingerprint before invoking the baker', async ({ page }) => {
  await page.goto('/?test=1');
  await expect(page.locator('[data-scene-node-kind="mesh"]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Bake', exact: true }).click();
  await page.evaluate(async () => {
    const { registerLumenDeliveryAdapter } = await import('/src/lumen-delivery.ts');
    (window as any).__bakerCalled = false;
    registerLumenDeliveryAdapter({ bake: async () => { (window as any).__bakerCalled = true; return {}; } });
  });
  const files = await selectedPackage(page);
  const manifest = JSON.parse(files[0]!.buffer.toString());
  manifest.source.sha256 = '0'.repeat(64);
  files[0]!.buffer = Buffer.from(JSON.stringify(manifest));
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Bake compiled geometry…' }).click();
  await (await chooser).setFiles(files);
  await expect(page.getByRole('alert')).toContainText('does not match');
  expect(await page.evaluate(() => (window as any).__bakerCalled)).toBe(false);
});
test('Studio refuses a compiled GLB selected without its compiler manifest', async ({ page }) => {
  await page.goto('/?test=1');
  await expect(page.locator('[data-scene-node-kind="mesh"]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Bake', exact: true }).click();
  await page.evaluate(async () => {
    const { registerLumenDeliveryAdapter } = await import('/src/lumen-delivery.ts');
    (window as any).__bakerCalled = false;
    registerLumenDeliveryAdapter({ bake: async () => { (window as any).__bakerCalled = true; return {}; } });
  });
  const geometry = (await selectedPackage(page))[1]!;
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Bake compiled geometry…' }).click();
  await (await chooser).setFiles(geometry);
  await expect(page.getByRole('alert')).toContainText('Select scene.json and geometry.glb');
  expect(await page.evaluate(() => (window as any).__bakerCalled)).toBe(false);
});
test('Studio discards a private Lumen transfer if source buffers change during bake', async ({ page }) => {
  await page.goto('/?test=1');
  await expect(page.locator('[data-scene-node-kind="mesh"]').first()).toBeVisible();
  await page.getByRole('button', { name: 'Bake', exact: true }).click();
  await page.evaluate(async () => {
    const { registerLumenDeliveryAdapter } = await import('/src/lumen-delivery.ts');
    registerLumenDeliveryAdapter({ bake: async ({ compiledGlb }: { compiledGlb: ArrayBuffer }) => {
      const digest = await crypto.subtle.digest('SHA-256', compiledGlb);
      await new Promise<void>(resolve => { (window as any).__finishLumenBake = resolve; });
      return {
        format: 'lightbaker-lumen-lighting-v2',
        geometrySha256: Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, '0')).join(''),
        geometryCorrespondence: 'compiled-glb-exact', lightingComponent: 'indirect-plus-baked-radiance', bakedRadianceIncluded: true,
        directLightingIncluded: false, encoding: 'linear-irradiance-f32-rgb',
        rowOrigin: 'uv-v-zero', uvChannel: 1, refined: true,
        atlases: [{ width: 1, height: 1, rgb: [0, 0, 0], bakedRadianceRgb: [0, 0, 0] }],
        bindings: [{ node: 0, mesh: 0, primitive: 0, atlas: 0, intensity: 1 }],
      };
    } });
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Bake compiled geometry…' }).click();
  await (await chooser).setFiles(await selectedPackage(page));
  await expect.poll(() => page.evaluate(() => typeof (window as any).__finishLumenBake)).toBe('function');
  await page.evaluate(() => {
    const studio = (window as any).__studio;
    let mesh: any;
    studio.roots()[0].traverse((node: any) => { if (!mesh && node.isMesh) mesh = node; });
    const position = mesh.geometry.getAttribute('position');
    position.setX(0, position.getX(0) + 0.125);
    position.needsUpdate = true;
    (window as any).__finishLumenBake();
  });
  await expect(page.getByRole('alert')).toContainText('scene changed during Lumen bake');
});
test('disposing Studio aborts a pending private Lumen bake', async ({ page }) => {
  await page.goto('/?test=1');
  await expect(page.locator('[data-scene-node-kind="mesh"]').first()).toBeVisible();
  const files = await selectedPackage(page);
  await page.evaluate(async () => {
    const { registerLumenDeliveryAdapter } = await import('/src/lumen-delivery.ts');
    registerLumenDeliveryAdapter({ bake: async ({ signal }: { signal: AbortSignal }) => {
      (window as any).__lumenBakeSignal = signal;
      await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      throw new Error('Bake aborted');
    } });
  });
  await page.evaluate(({ manifest, geometry }) => {
    const files = [new File([new Uint8Array(manifest)], 'scene.json'), new File([new Uint8Array(geometry)], 'geometry.glb')];
    void (window as any).__studio.deliverLumenTransfer(files);
  }, { manifest: Array.from(files[0]!.buffer), geometry: Array.from(files[1]!.buffer) });
  await expect.poll(() => page.evaluate(() => !!(window as any).__lumenBakeSignal)).toBe(true);
  await page.evaluate(() => (window as any).__studio.dispose());
  expect(await page.evaluate(() => (window as any).__lumenBakeSignal.aborted)).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test("View effects render without shader errors and invalid projects keep the current scene", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/?test=1");
  await expect(
    page.locator('[data-scene-node-kind="mesh"]').first(),
  ).toBeVisible();
  const before = await page.locator("[data-scene-node-id]").count();
  await page.evaluate(async () => {
    const s = (window as any).__studio;
    const p = s.document();
    p.settings.bake.samples = -5;
    await s.openProject(p);
  });
  await expect(page.getByRole("alert")).toContainText("Invalid");
  expect(await page.locator("[data-scene-node-id]").count()).toBe(before);
  await page.getByRole("button", { name: "Dismiss" }).click();
  await page.evaluate(() => {
    const s = (window as any).__studio;
    s.editView({
      ...s.view().postFX,
      master: true,
      bloom2Enabled: true,
      hueSatEnabled: true,
      hue: 0.1,
      gamma: 1.1,
      lensDistortionEnabled: true,
      vignetteEnabled: true,
      fogEnabled: true,
    });
  });
  await page.getByRole("button", { name: "View", exact: true }).last().click();
  await page.screenshot({ path: "test-results/view-effects.png" });
  expect(errors).toEqual([]);
});
test("live platform produces an artifact from the authored Studio scene", async ({
  page,
}) => {
  test.skip(
    !process.env.LIVE_PLATFORM,
    "Opt in against the separately running private platform",
  );
  test.setTimeout(180000);
  await page.goto("/?test=1");
  await expect(
    page.locator('[data-scene-node-kind="mesh"]').first(),
  ).toBeVisible();
  await page.evaluate(() =>
    (window as any).__studio.editSettings({
      world: { color: "#17191d", intensity: 0.15 },
      bake: { resolution: 128, samples: 4, bounces: 0, denoise: false },
    }),
  );
  await page.getByTestId("bake").click();
  await expect(page.getByText("Platform result matches authored scene")).toBeVisible({
    timeout: 150000,
  });
  await expect(page.getByAltText("Platform baked scene preview")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path: "test-results/live-platform.png" });
});
test("Bake uploads complete GLB metadata and never clears edits made during a job", async ({
  page,
}) => {
  let complete = false;
  let polls = 0;
  let payload: any;
  await page.route("http://127.0.0.1:8787/**", async (route) => {
    const url = new URL(route.request().url());
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "POST,GET,OPTIONS",
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    if (url.pathname === "/bakeScene") {
      const bytes = route.request().postDataBuffer()!;
      expect(bytes.readUInt32LE(0)).toBe(0x46546c67);
      payload = JSON.parse(
        bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString(),
      );
      await route.fulfill({ json: { id: "job-1", status: "queued" }, headers });
    } else if (url.pathname.startsWith("/getJob")) {
      polls++;
      await route.fulfill({
        json: {
          id: "job-1",
          status: complete ? "completed" : "running",
          progress: 50,
        },
        headers,
      });
    } else
      await route.fulfill({
        json: [
          {
            kind: "preview",
            name: "Preview",
            url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/%3E',
          },
        ],
        headers,
      });
  });
  await page.goto("/?test=1");
  await expect(
    page.locator('[data-scene-node-kind="mesh"]').first(),
  ).toBeVisible();
  await page.getByTestId("bake").click();
  await expect.poll(() => polls).toBeGreaterThan(0);
  const extras = payload.scenes[0].extras;
  expect(extras.lightbaker.version).toBe(2);
  expect(extras.lightbaker.world).toBeTruthy();
  expect(extras.lightbaker.view.position).toHaveLength(3);
  expect(payload.nodes.some((n: any) => n.extras?.lightbakerMesh)).toBe(true);
  expect(
    payload.nodes.some((n: any) => n.extras?.lightbakerLight?.type === "area"),
  ).toBe(true);
  expect(
    payload.nodes.some(
      (n: any) => n.extras?.editorOnly || n.type?.includes("Helper"),
    ),
  ).toBe(false);
  await page.locator('[data-asset-tile="cube"]').dblclick();
  complete = true;
  await expect(page.getByText("Earlier scene result (stale)")).toBeVisible();
  await page.getByTestId("bake").click();
  await expect(page.getByText("Platform result matches authored scene")).toBeVisible();
  await page.locator('[data-scene-node-kind="mesh"]').first().click();
  await expect(page.getByText("Platform result matches authored scene")).toBeVisible();
  await page
    .getByRole("button", { name: "Delete", exact: true })
    .first()
    .click();
  await expect(page.getByText("Earlier scene result (stale)")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Platform result matches authored scene")).toBeVisible();
});
test("Studio restores legacy assets, inspector history and project persistence", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?test=1");
  await expect(
    page.locator('[data-scene-node-kind="mesh"]').first(),
  ).toBeVisible();
  await page.locator('[data-asset-tile="sphere"]').dblclick();
  await expect(page.locator('[data-selected="true"]')).toContainText("Sphere");
  const name = page.getByRole("textbox").first();
  await name.fill("Authored sphere");
  await name.press("Tab");
  await expect(page.locator('[data-selected="true"]')).toContainText(
    "Authored sphere",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.locator('[data-selected="true"]')).toContainText("Sphere");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(page.locator('[data-selected="true"]')).toContainText(
    "Authored sphere",
  );
  const before = await page.evaluate(() => (window as any).__studio.document());
  await page.evaluate(async (data) => {
    await (window as any).__studio.openProject(data);
  }, before);
  await expect(
    page
      .locator('[data-scene-node-kind="mesh"]')
      .filter({ hasText: "Authored sphere" }),
  ).toHaveCount(1);
  await page.locator('[data-asset-tile="point"]').dblclick();
  await expect(page.locator('[data-selected="true"]')).toContainText(
    "Point Light",
  );
  await page
    .getByRole("button", { name: "Delete", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(
    page
      .locator('[data-scene-node-kind="light"]')
      .filter({ hasText: "Point Light" }),
  ).toHaveCount(1);
  await page.screenshot({ path: "test-results/studio.png" });
  expect(errors).toEqual([]);
});
test("All public presets load and scene replacement removes old lights", async ({
  page,
}) => {
  await page.goto("/?test=1");
  await expect(
    page.locator('[data-scene-node-kind="mesh"]').first(),
  ).toBeVisible();
  const ids = [
    "cornell.advanced",
    "cornell.glass-mirror",
    "cornell.emissive-strip",
    "threejs.pointlights",
    "threejs.shadowmap",
    "threejs.decals",
    "isometric.room",
    "showcase.probe-architectural",
    "esl.gym",
    "esl.desert",
    "esl.backrooms",
    "cornell.classic",
  ];
  for (const id of ids) {
    await page.evaluate(async (id) => {
      await (window as any).__studio.loadScenePreset(id);
    }, id);
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
    await expect(
      page.locator('[data-scene-node-kind="mesh"]').first(),
    ).toBeVisible();
  }
  await expect(page.locator('[data-scene-node-kind="light"]')).toHaveCount(1);
});

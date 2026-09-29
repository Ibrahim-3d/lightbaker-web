import { test, expect } from "@playwright/test";
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
  await expect(page.getByText("Bake matches authored lighting")).toBeVisible({
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
  await expect(page.getByText("Bake matches authored lighting")).toBeVisible();
  await page.locator('[data-scene-node-kind="mesh"]').first().click();
  await expect(page.getByText("Bake matches authored lighting")).toBeVisible();
  await page
    .getByRole("button", { name: "Delete", exact: true })
    .first()
    .click();
  await expect(page.getByText("Earlier scene result (stale)")).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("Bake matches authored lighting")).toBeVisible();
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

import { it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

it("public sources do not import private baking engines or ship compute/bake modules", () => {
  function visit(path: string): string[] {
    return readdirSync(path, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? visit(join(path, e.name)) : [join(path, e.name)],
    );
  }
  const files = ["src", "apps", "packages"].flatMap(visit);
  expect(
    files.filter((f) =>
      /\.(wgsl|comp)$|(?:BVH|BakeController|PTController|ProbeController)\./i.test(
        f,
      ),
    ),
  ).toEqual([]);
  const forbidden =
    /(?:from\s*|import\s*\()['"](?:baker-classic|baker-webgpu|pt-renderer|[^'"]*lightbaker-platform)/;
  for (const file of files.filter((f) => /\.tsx?$/.test(f)))
    expect(readFileSync(file, "utf8"), file).not.toMatch(forbidden);
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  expect(
    Object.keys(pkg.dependencies).some((k) =>
      /lightbaker|baker-classic|three-mesh-bvh|three-gpu-pathtracer/.test(k),
    ),
  ).toBe(false);
});

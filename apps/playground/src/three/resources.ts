import { BufferGeometry, Material, Object3D, Texture } from "three";

function resources(root: Object3D): Set<{ dispose(): void }> {
  const found = new Set<{ dispose(): void }>();
  root.traverse((o) => {
    const r = o as Object3D & {
      geometry?: BufferGeometry;
      material?: Material | Material[];
    };
    if (r.geometry) found.add(r.geometry);
    const shadow = (o as Object3D & { shadow?: { dispose(): void } }).shadow;
    if (shadow) found.add(shadow);
    for (const m of r.material
      ? Array.isArray(r.material)
        ? r.material
        : [r.material]
      : []) {
      found.add(m);
      for (const value of Object.values(m))
        if (value instanceof Texture) found.add(value);
    }
  });
  return found;
}

/** Dispose shared resources once, retaining anything still owned by another live/history root. */
export function disposeTrees(
  roots: Object3D[],
  retained: Object3D[] = [],
): void {
  const keep = new Set(retained.flatMap((r) => [...resources(r)]));
  const drop = new Set(roots.flatMap((r) => [...resources(r)]));
  for (const resource of drop) if (!keep.has(resource)) resource.dispose();
}

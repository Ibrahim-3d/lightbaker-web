import {
  Light,
  Mesh,
  MeshStandardMaterial,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PointLight,
  RectAreaLight,
  SpotLight,
} from "three";
import { useState } from "preact/hooks";
import {
  BoolField,
  ColorField,
  NumberField,
  Row,
  Section,
  SelectField,
  TextField,
  getOrchestratorAs,
  objectTick,
  selectedId,
  activeCameraId,
} from "shared";
import { meshBake } from "../../../../src/contract";
import { settings, type Studio } from "../../../../src/studio";

const app = () => getOrchestratorAs<Studio>()!;
const selected = () => {
  void objectTick.value;
  return app()?.lookupObject(selectedId.value);
};
const note = (text: string) => (
  <p class="p-3 text-text-1 text-[11px]">{text}</p>
);
export function ObjectPage() {
  const o = selected();
  if (!o) return note("Select an object in the outliner or viewport.");
  const edit = (label: string, fn: () => void) => app().edit(label, o, fn);
  const camera = o.children.find((c) => c instanceof PerspectiveCamera) as
    PerspectiveCamera | undefined;
  const bake = meshBake(o);
  return (
    <>
      <Section title="Object">
        <Row label="Name">
          <TextField
            value={o.name}
            onChange={(v) =>
              edit("Rename", () => {
                o.name = v;
              })
            }
          />
        </Row>
        <Row label="Visible">
          <BoolField
            value={o.visible}
            onChange={(v) => app().setNodeVisible(o.uuid, v)}
          />
        </Row>
        <Row label="Actions">
          <button onClick={() => app().frameNode(o.uuid)}>Frame</button>
          <button onClick={() => app().deleteSelected()}>Delete</button>
        </Row>
      </Section>
      <Section title="Transform">
        {(["position", "rotation", "scale"] as const)
          .filter((channel) => channel !== "scale" || o instanceof Mesh)
          .map((channel) => (
            <Row
              key={channel}
              label={channel === "rotation" ? "Rotation (degrees)" : channel}
            >
              {(["x", "y", "z"] as const).map((axis) => (
                <span
                  class="flex flex-1 min-w-0 items-center gap-1"
                  title={axis.toUpperCase()}
                >
                  <span class="text-[9px]">{axis}</span>
                  <NumberField
                    value={
                      channel === "rotation"
                        ? (o.rotation[axis] * 180) / Math.PI
                        : o[channel][axis]
                    }
                    step={channel === "rotation" ? 1 : 0.1}
                    min={channel === "scale" ? 0.001 : undefined}
                    onChange={(v) =>
                      edit("Transform", () => {
                        o[channel][axis] =
                          channel === "rotation" ? (v * Math.PI) / 180 : v;
                      })
                    }
                  />
                </span>
              ))}
            </Row>
          ))}
      </Section>
      {camera && (
        <Section title="Camera">
          <Row label="View">
            <button onClick={() => app().setAsViewCamera(o.uuid)}>
              View through
            </button>
            <button
              onClick={() => {
                activeCameraId.value = null;
              }}
            >
              Free view
            </button>
          </Row>
          <Row label="Pose">
            <button onClick={() => app().captureCamera(o.uuid)}>
              Capture viewport
            </button>
          </Row>
          {(["fov", "aspect", "near", "far"] as const).map((key) => (
            <Row label={key}>
              <NumberField
                value={camera[key]}
                min={
                  key === "fov"
                    ? 10
                    : key === "far"
                      ? camera.near + 0.01
                      : 0.001
                }
                max={
                  key === "fov"
                    ? 120
                    : key === "near"
                      ? camera.far - 0.01
                      : 10000
                }
                onChange={(v) =>
                  edit("Camera", () => {
                    camera[key] = v;
                    camera.updateProjectionMatrix();
                  })
                }
              />
            </Row>
          ))}
        </Section>
      )}
      {o instanceof Mesh && (
        <Section title="Mesh bake contract">
          <Row label="Receive lightmap">
            <BoolField
              value={bake.receive}
              onChange={(v) =>
                edit("Receive lightmap", () => {
                  o.userData.lightbakerMesh = { ...bake, receive: v };
                })
              }
            />
          </Row>
          <Row label="Contribute lighting">
            <BoolField
              value={bake.contribute}
              onChange={(v) =>
                edit("Contribute lighting", () => {
                  o.userData.lightbakerMesh = { ...bake, contribute: v };
                })
              }
            />
          </Row>
          <Row label="Density multiplier">
            <NumberField
              value={bake.density}
              min={0.25}
              max={4}
              step={0.25}
              onChange={(v) =>
                edit("Mesh density", () => {
                  o.userData.lightbakerMesh = { ...bake, density: v };
                })
              }
            />
          </Row>
          {note(
            "Saved and exported. The current platform worker does not yet interpret per-mesh bake overrides.",
          )}
        </Section>
      )}
    </>
  );
}

export function MaterialPage() {
  const o = selected();
  const [slot, setSlot] = useState(0);
  if (!(o instanceof Mesh)) return note("Select a mesh to edit its material.");
  const materials = Array.isArray(o.material) ? o.material : [o.material];
  const index = Math.min(slot, materials.length - 1);
  const m = materials[index];
  if (!(m instanceof MeshStandardMaterial))
    return note(
      "This material is not a standard PBR material. Its original data is preserved.",
    );
  const edit = (fn: () => void) =>
    app().edit("Material", o, () => {
      fn();
      m.needsUpdate = true;
    });
  return (
    <>
      {materials.length > 1 && (
        <Row label="Material slot">
          <SelectField
            value={String(index)}
            options={materials.map((m, i) => ({
              value: String(i),
              label: m.name || `Slot ${i + 1}`,
            }))}
            onChange={(v) => setSlot(Number(v))}
          />
        </Row>
      )}
      <Section title="Surface">
        <Row label="Base color">
          <ColorField
            value={"#" + m.color.getHexString()}
            onChange={(v) =>
              edit(() => {
                m.color.set(v);
              })
            }
          />
        </Row>
        {(["roughness", "metalness", "opacity"] as const).map((k) => (
          <Row label={k}>
            <NumberField
              value={m[k]}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) =>
                edit(() => {
                  m[k] = v;
                })
              }
            />
          </Row>
        ))}
        <Row label="Transparent">
          <BoolField
            value={m.transparent}
            onChange={(v) =>
              edit(() => {
                m.transparent = v;
              })
            }
          />
        </Row>
        <Row label="Sidedness">
          <SelectField
            value={String(m.side)}
            options={[
              { value: "0", label: "Front" },
              { value: "2", label: "Double" },
            ]}
            onChange={(v) =>
              edit(() => {
                m.side = Number(v) as 0 | 2;
              })
            }
          />
        </Row>
      </Section>
      <Section title="Emissive">
        <Row label="Emission color">
          <ColorField
            value={"#" + m.emissive.getHexString()}
            onChange={(v) =>
              edit(() => {
                m.emissive.set(v);
              })
            }
          />
        </Row>
        <Row label="Emission intensity">
          <NumberField
            value={m.emissiveIntensity}
            min={0}
            max={100}
            onChange={(v) =>
              edit(() => {
                m.emissiveIntensity = v;
              })
            }
          />
        </Row>
      </Section>
      {m instanceof MeshPhysicalMaterial && (
        <Section title="Physical material">
          <Row label="Transmission">
            <NumberField
              value={m.transmission}
              min={0}
              max={1}
              onChange={(v) =>
                edit(() => {
                  m.transmission = v;
                })
              }
            />
          </Row>
          <Row label="IOR">
            <NumberField
              value={m.ior}
              min={1}
              max={2.333}
              onChange={(v) =>
                edit(() => {
                  m.ior = v;
                })
              }
            />
          </Row>
          <Row label="Thickness">
            <NumberField
              value={m.thickness}
              min={0}
              max={100}
              onChange={(v) =>
                edit(() => {
                  m.thickness = v;
                })
              }
            />
          </Row>
          {note(
            "Physical material values are exported through glTF extensions. Platform transport support is not guaranteed.",
          )}
        </Section>
      )}
    </>
  );
}

export function LightPage() {
  const o = selected();
  const light = o?.children.find((c) => c instanceof Light) as
    Light | undefined;
  if (!o || !light)
    return note("Select a Point, Spot, Directional or Area light.");
  const edit = (fn: () => void) => app().edit("Light", o, fn);
  return (
    <Section title={`${o.userData.bakerLightType} light`}>
      <Row label="Color">
        <ColorField
          value={"#" + light.color.getHexString()}
          onChange={(v) =>
            edit(() => {
              light.color.set(v);
            })
          }
        />
      </Row>
      <Row label="Intensity">
        <NumberField
          value={light.intensity}
          min={0}
          max={100}
          onChange={(v) =>
            edit(() => {
              light.intensity = v;
            })
          }
        />
      </Row>
      {(light instanceof PointLight || light instanceof SpotLight) && (
        <>
          <Row label="Range (0 = infinite)">
            <NumberField
              value={light.distance}
              min={0}
              max={1000}
              onChange={(v) =>
                edit(() => {
                  light.distance = v;
                })
              }
            />
          </Row>
          <Row label="Decay">
            <NumberField
              value={light.decay}
              min={0}
              max={4}
              onChange={(v) =>
                edit(() => {
                  light.decay = v;
                })
              }
            />
          </Row>
        </>
      )}
      {light instanceof SpotLight && (
        <>
          <Row label="Cone half-angle (°)">
            <NumberField
              value={(light.angle * 180) / Math.PI}
              min={1}
              max={89}
              onChange={(v) =>
                edit(() => {
                  light.angle = (v * Math.PI) / 180;
                })
              }
            />
          </Row>
          <Row label="Penumbra">
            <NumberField
              value={light.penumbra}
              min={0}
              max={1}
              onChange={(v) =>
                edit(() => {
                  light.penumbra = v;
                })
              }
            />
          </Row>
        </>
      )}
      {light instanceof RectAreaLight && (
        <>
          {(["width", "height"] as const).map((k) => (
            <Row label={k}>
              <NumberField
                value={light[k]}
                min={0.05}
                max={100}
                onChange={(v) =>
                  edit(() => {
                    light[k] = v;
                  })
                }
              />
            </Row>
          ))}
        </>
      )}
      {note(
        "Aim lights with the rotation gizmo. Point, Spot and Directional use glTF punctual lights; Area uses versioned extras. The current platform requires at least one area light.",
      )}
    </Section>
  );
}
export function WorldPage() {
  const s = settings.value;
  return (
    <Section title="Environment">
      <Row label="Sky color">
        <ColorField
          value={s.world.color}
          onChange={(v) =>
            app().editSettings({ ...s, world: { ...s.world, color: v } })
          }
        />
      </Row>
      <Row label="Sky intensity">
        <NumberField
          value={s.world.intensity}
          min={0}
          max={4}
          step={0.05}
          onChange={(v) =>
            app().editSettings({ ...s, world: { ...s.world, intensity: v } })
          }
        />
      </Row>
      {note(
        "The platform uses this constant sky for escaped rays. The viewport uses an ambient approximation. HDR environment authoring is unavailable until the platform supports portable HDR assets.",
      )}
    </Section>
  );
}
export function BakePage() {
  const s = settings.value;
  return (
    <>
      <Section title="Bake quality">
        <Row label="Apply preset">
          <button
            onClick={() =>
              app().editSettings({
                ...s,
                bake: {
                  resolution: 256,
                  samples: 16,
                  bounces: 2,
                  denoise: true,
                },
              })
            }
          >
            Preview
          </button>
          <button
            onClick={() =>
              app().editSettings({
                ...s,
                bake: {
                  resolution: 512,
                  samples: 64,
                  bounces: 2,
                  denoise: true,
                },
              })
            }
          >
            Production
          </button>
        </Row>
        <Row label="Atlas resolution">
          <NumberField
            value={s.bake.resolution}
            min={128}
            max={1024}
            step={128}
            onChange={(v) =>
              app().editSettings({
                ...s,
                bake: { ...s.bake, resolution: Math.round(v) },
              })
            }
          />
        </Row>
        <Row label="Samples">
          <NumberField
            value={s.bake.samples}
            min={4}
            max={128}
            step={1}
            onChange={(v) =>
              app().editSettings({
                ...s,
                bake: { ...s.bake, samples: Math.round(v) },
              })
            }
          />
        </Row>
        <Row label="Bounces">
          <NumberField
            value={s.bake.bounces}
            min={0}
            max={4}
            step={1}
            onChange={(v) =>
              app().editSettings({
                ...s,
                bake: { ...s.bake, bounces: Math.round(v) },
              })
            }
          />
        </Row>
        <Row label="Denoise">
          <BoolField
            value={s.bake.denoise}
            onChange={(v) =>
              app().editSettings({ ...s, bake: { ...s.bake, denoise: v } })
            }
          />
        </Row>
      </Section>
      {note(
        "Bake sends geometry, materials, lights, transforms, world, mesh overrides and view metadata to LightBaker Platform. No baker runs in this application. Values shown are the exact requested settings; presets only fill these fields.",
      )}
      {note(
        "Current worker limitations: an area light is required; per-mesh overrides, hidden-object filtering and viewport effects are not yet interpreted. These authored values are preserved in the export.",
      )}
    </>
  );
}

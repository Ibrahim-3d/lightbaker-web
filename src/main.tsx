import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Object3D } from 'three';
import { SceneEditor, type TransformMode } from './editor';
import { apiUrl, provider, type BakeArtifact, type BakeJob } from './provider';
import './style.css';

type InspectorTab = 'object' | 'material' | 'light' | 'world' | 'bake';

interface BakeSettings {
  resolution: number;
  samples: number;
  bounces: number;
  denoise: boolean;
}

function App() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<SceneEditor | null>(null);
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<InspectorTab>('object');
  const [mode, setMode] = useState<TransformMode>('translate');
  const [worldColor, setWorldColor] = useState('#17191d');
  const [worldIntensity, setWorldIntensity] = useState(0.15);
  const [quality, setQuality] = useState<'preview' | 'production'>('preview');
  const [bakeSettings, setBakeSettings] = useState<BakeSettings>({
    resolution: 256,
    samples: 16,
    bounces: 2,
    denoise: true,
  });
  const [job, setJob] = useState<BakeJob | null>(null);
  const [artifacts, setArtifacts] = useState<BakeArtifact[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(true);

  useEffect(() => {
    if (!viewportRef.current) return;
    const editor = new SceneEditor(viewportRef.current, {
      onChange: () => {
        setRevision((value) => value + 1);
        setStale(true);
      },
      onSelectionChange: setSelectedId,
    });
    editorRef.current = editor;
    return () => {
      editor.dispose();
      editorRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return;
    const timer = window.setInterval(async () => {
      try {
        const current = await provider.getJob(job.id);
        setJob(current);
        if (current.status === 'completed') {
          setArtifacts(await provider.getArtifacts(job.id));
          setStale(false);
        }
        if (current.status === 'failed') setError(current.error ?? 'The bake failed.');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not check the bake job.');
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      const key = event.key.toLowerCase();
      if (key === 'g' || key === 'r' || key === 's') {
        const next = key === 'g' ? 'translate' : key === 'r' ? 'rotate' : 'scale';
        setMode(next);
        editorRef.current?.setTransformMode(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const editor = editorRef.current;
  void revision;
  const selected = editor?.selected ?? null;
  const nodes = editor?.nodes() ?? [];
  const preview = artifacts.find((artifact) => artifact.kind === 'preview') ?? artifacts[0];

  function chooseMode(next: TransformMode): void {
    setMode(next);
    editorRef.current?.setTransformMode(next);
  }

  function applyQuality(next: 'preview' | 'production'): void {
    setQuality(next);
    setBakeSettings(
      next === 'production'
        ? { resolution: 512, samples: 64, bounces: 2, denoise: true }
        : { resolution: 256, samples: 16, bounces: 2, denoise: true },
    );
    setStale(true);
  }

  async function startBake(): Promise<void> {
    const activeEditor = editorRef.current;
    if (!activeEditor || busy) return;
    setBusy(true);
    setError('');
    setArtifacts([]);
    setJob(null);
    try {
      const data = await activeEditor.exportGLB({
        world: { color: worldColor, intensity: worldIntensity },
        bake: bakeSettings,
      });
      const file = new File([data], 'lightbaker-editor-scene.glb', {
        type: 'model/gltf-binary',
      });
      const started = await provider.bakeScene({ file }, { quality });
      setJob(started);
      if (started.status === 'completed') {
        setArtifacts(await provider.getArtifacts(started.id));
        setStale(false);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the bake.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main class="editor-shell">
      <header class="topbar">
        <div class="brand"><span class="brand-mark">✦</span> LIGHTBAKER <span>STUDIO</span></div>
        <div class="scene-title"><span class={stale ? 'stale-dot' : 'saved-dot'} /> Cornell Verification Scene</div>
        <div class="top-actions">
          <button class="ghost-button" onClick={() => editorRef.current?.resetCornellScene()}>Reset scene</button>
          <button class="bake-button" disabled={busy || job?.status === 'running' || job?.status === 'queued'} onClick={startBake}>
            {busy ? 'Preparing…' : job?.status === 'running' || job?.status === 'queued' ? `Baking ${job.progress ?? 0}%` : 'Bake on platform'}
          </button>
        </div>
      </header>

      <section class="workspace">
        <aside class="outliner panel">
          <div class="panel-title"><span>OUTLINER</span><small>{nodes.length} objects</small></div>
          <div class="tree">
            <TreeGroup label="Lights" nodes={nodes.filter((node) => node.kind === 'light')} selectedId={selectedId} />
            <TreeGroup label="Meshes" nodes={nodes.filter((node) => node.kind === 'mesh')} selectedId={selectedId} />
          </div>
          <div class="scene-note">
            <strong>Cornell test scene</strong>
            <span>Five walls, two blocks, and one editable ceiling area light.</span>
          </div>
        </aside>

        <div class="viewport-wrap">
          <div ref={viewportRef} class="viewport" data-testid="viewport" />
          <div class="viewport-tools" aria-label="Transform tools">
            {(['translate', 'rotate', 'scale'] as TransformMode[]).map((item) => (
              <button class={mode === item ? 'active' : ''} title={`${item} (${item === 'translate' ? 'G' : item === 'rotate' ? 'R' : 'S'})`} onClick={() => chooseMode(item)}>
                {item === 'translate' ? '↔' : item === 'rotate' ? '⟳' : '⤢'}
              </button>
            ))}
          </div>
          <div class="viewport-label"><span>SOLID</span><span>Perspective</span></div>

          {(job || error) && (
            <div class={`bake-status ${error ? 'has-error' : ''}`}>
              <div>
                <small>{error ? 'PLATFORM ERROR' : 'REMOTE BAKE'}</small>
                <strong>{error || (job?.status === 'completed' ? 'Bake complete' : `${job?.status ?? 'preparing'} · ${job?.progress ?? 0}%`)}</strong>
              </div>
              {job && job.status !== 'completed' && <div class="progress"><i style={{ width: `${job.progress ?? 0}%` }} /></div>}
            </div>
          )}

          {preview && (
            <div class="result-card">
              <div class="result-head"><div><small>PLATFORM RESULT</small><strong>{preview.name}</strong></div><button onClick={() => setArtifacts([])}>×</button></div>
              <img src={preview.url} crossOrigin="anonymous" alt="Baked Cornell scene returned by LightBaker Platform" />
              <div class="result-links">
                {artifacts.map((artifact) => <a href={artifact.url} target="_blank" rel="noreferrer">{artifact.kind} ↗</a>)}
              </div>
            </div>
          )}
        </div>

        <aside class="inspector panel">
          <div class="tabs">
            {(['object', 'material', 'light', 'world', 'bake'] as InspectorTab[]).map((item) => (
              <button class={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}</button>
            ))}
          </div>
          <div class="inspector-body">
            {tab === 'object' && <ObjectPanel selected={selected} />}
            {tab === 'material' && <MaterialPanel selected={selected} />}
            {tab === 'light' && <LightPanel />}
            {tab === 'world' && (
              <>
                <PanelSection title="Environment">
                  <Field label="Background"><input type="color" value={worldColor} onInput={(event) => { const value = event.currentTarget.value; setWorldColor(value); editorRef.current?.setWorldColor(value); setStale(true); }} /></Field>
                  <Slider label="Sky intensity" value={worldIntensity} min={0} max={2} step={0.05} onChange={(value) => { setWorldIntensity(value); setStale(true); }} />
                </PanelSection>
                <PanelSection title="Scene">
                  <p class="help-copy">Sky intensity fills rays that leave the room and is sent with the scene to the platform baker.</p>
                </PanelSection>
              </>
            )}
            {tab === 'bake' && (
              <>
                <PanelSection title="Quality">
                  <Field label="Preset"><select value={quality} onChange={(event) => applyQuality(event.currentTarget.value as 'preview' | 'production')}><option value="preview">Preview</option><option value="production">Production</option></select></Field>
                  <NumberInput label="Atlas size" value={bakeSettings.resolution} min={128} max={1024} step={128} onChange={(resolution) => { setBakeSettings({ ...bakeSettings, resolution }); setStale(true); }} />
                  <NumberInput label="Samples" value={bakeSettings.samples} min={4} max={128} step={4} onChange={(samples) => { setBakeSettings({ ...bakeSettings, samples }); setStale(true); }} />
                  <NumberInput label="Bounces" value={bakeSettings.bounces} min={0} max={4} step={1} onChange={(bounces) => { setBakeSettings({ ...bakeSettings, bounces }); setStale(true); }} />
                  <Field label="Denoise"><input type="checkbox" checked={bakeSettings.denoise} onChange={(event) => { setBakeSettings({ ...bakeSettings, denoise: event.currentTarget.checked }); setStale(true); }} /></Field>
                </PanelSection>
                <PanelSection title="Delivery">
                  <p class="help-copy">The editor exports GLB geometry and metadata. The private platform performs the bake and returns a rendered preview and lightmap.</p>
                  <button class="full-bake" onClick={startBake} disabled={busy || job?.status === 'running' || job?.status === 'queued'}>Bake current scene</button>
                </PanelSection>
              </>
            )}
          </div>
        </aside>
      </section>

      <footer class="statusbar"><span>{stale ? 'Scene changed · bake required' : 'Bake matches current scene'}</span><span>API {apiUrl}</span><span>G move · R rotate · S scale</span></footer>
    </main>
  );

  function TreeGroup({ label, nodes: groupNodes, selectedId: current }: { label: string; nodes: ReturnType<SceneEditor['nodes']>; selectedId: string | null }) {
    if (!groupNodes.length) return null;
    return <div class="tree-group"><div class="tree-label">{label}</div>{groupNodes.map((node) => <div class={`tree-row ${current === node.id ? 'selected' : ''}`} onClick={() => { editorRef.current?.selectById(node.id); if (node.kind === 'light') setTab('light'); }} onDblClick={() => editorRef.current?.frameSelected()}><span class="node-icon">{node.kind === 'light' ? '☼' : '◇'}</span><span>{node.name}</span><button title={node.visible ? 'Hide' : 'Show'} onClick={(event) => { event.stopPropagation(); editorRef.current?.setVisible(node.id, !node.visible); }}>{node.visible ? '●' : '○'}</button></div>)}</div>;
  }

  function ObjectPanel({ selected: object }: { selected: Object3D | null }) {
    if (!object) return <Empty text="Select an object in the outliner or viewport." />;
    return <>
      <PanelSection title="Object">
        <Field label="Name"><input value={object.name} onInput={(event) => { object.name = event.currentTarget.value; setRevision((value) => value + 1); setStale(true); }} /></Field>
        <Field label="Visible"><input type="checkbox" checked={object.visible} onChange={(event) => editorRef.current?.setVisible(object.uuid, event.currentTarget.checked)} /></Field>
      </PanelSection>
      <PanelSection title="Transform">
        <VectorField label="Position" values={[object.position.x, object.position.y, object.position.z]} onChange={(axis, value) => editorRef.current?.updateSelectedTransform(axis, value, 'position')} />
        <VectorField label="Rotation" values={[object.rotation.x, object.rotation.y, object.rotation.z]} onChange={(axis, value) => editorRef.current?.updateSelectedTransform(axis, value, 'rotation')} />
        <VectorField label="Scale" values={[object.scale.x, object.scale.y, object.scale.z]} onChange={(axis, value) => editorRef.current?.updateSelectedTransform(axis, value, 'scale')} />
      </PanelSection>
    </>;
  }

  function MaterialPanel({ selected: object }: { selected: Object3D | null }) {
    const material = editorRef.current?.getSelectedMaterial();
    if (!object || !material) return <Empty text="Select a mesh to edit its material." />;
    return <>
      <PanelSection title="Base material">
        <Field label="Color"><input type="color" value={`#${material.color.getHexString()}`} onInput={(event) => editorRef.current?.updateSelectedMaterial({ color: event.currentTarget.value })} /></Field>
        <Slider label="Roughness" value={material.roughness} min={0} max={1} step={0.01} onChange={(roughness) => editorRef.current?.updateSelectedMaterial({ roughness })} />
        <Slider label="Metalness" value={material.metalness} min={0} max={1} step={0.01} onChange={(metalness) => editorRef.current?.updateSelectedMaterial({ metalness })} />
      </PanelSection>
      <PanelSection title="Bake material"><p class="help-copy">Material color participates in direct and bounced lighting on the platform.</p></PanelSection>
    </>;
  }

  function LightPanel() {
    const light = editorRef.current?.getSelectedAreaLight();
    if (!light) return <Empty text="Select the ceiling area light to edit it." />;
    return <>
      <PanelSection title="Area light">
        <Field label="Color"><input type="color" value={`#${light.color.getHexString()}`} onInput={(event) => editorRef.current?.updateSelectedAreaLight({ color: event.currentTarget.value })} /></Field>
        <Slider label="Intensity" value={light.intensity} min={0} max={30} step={0.25} onChange={(intensity) => editorRef.current?.updateSelectedAreaLight({ intensity })} />
        <Slider label="Width" value={light.width} min={0.25} max={6} step={0.1} onChange={(width) => editorRef.current?.updateSelectedAreaLight({ width })} />
        <Slider label="Height" value={light.height} min={0.25} max={6} step={0.1} onChange={(height) => editorRef.current?.updateSelectedAreaLight({ height })} />
      </PanelSection>
      <PanelSection title="Direction"><p class="help-copy">The emitter points along local −Z. Use the rotate gizmo to aim it.</p></PanelSection>
    </>;
  }
}

function PanelSection({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return <section class="inspector-section"><h3>{title}</h3>{children}</section>;
}

function Field({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return <label class="field"><span>{label}</span><div>{children}</div></label>;
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <Field label={label}><div class="slider"><input type="range" value={value} min={min} max={max} step={step} onInput={(event) => onChange(Number(event.currentTarget.value))} /><input type="number" value={Number(value.toFixed(2))} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.currentTarget.value))} /></div></Field>;
}

function NumberInput({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <Field label={label}><input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.currentTarget.value))} /></Field>;
}

function VectorField({ label, values, onChange }: { label: string; values: [number, number, number]; onChange: (axis: 'x' | 'y' | 'z', value: number) => void }) {
  const axes = ['x', 'y', 'z'] as const;
  return <Field label={label}><div class="vector-field">{axes.map((axis, index) => <label><span>{axis.toUpperCase()}</span><input type="number" value={Number(values[index].toFixed(3))} step={0.1} onChange={(event) => onChange(axis, Number(event.currentTarget.value))} /></label>)}</div></Field>;
}

function Empty({ text }: { text: string }) {
  return <div class="empty-panel">{text}</div>;
}

render(<App />, document.getElementById('app')!);

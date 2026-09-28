import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { provider, type BakeArtifact, type BakeJob } from './provider';
import './style.css';

const source = 'https://raw.githubusercontent.com/Ibrahim-3d/three-lightmap-baker/e73efec8e179689d952c99c2f964aca8ed35b7b5/screenshots/';
const examples = [
  { title: 'Solid viewport', image: 'before-solid-viewport.png', caption: 'Original scene' },
  { title: 'Preview bake', image: 'after-preview-baked-combined.png', caption: 'Fast lighting pass' },
  { title: 'Production bake', image: 'after-production-baked-combined.png', caption: 'Final lightmap' },
];
const liveApi = Boolean(import.meta.env.VITE_LIGHTBAKER_API_URL);

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [quality, setQuality] = useState<'preview' | 'production'>('preview');
  const [job, setJob] = useState<BakeJob | null>(null);
  const [artifacts, setArtifacts] = useState<BakeArtifact[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!job || (job.status !== 'queued' && job.status !== 'running')) return;
    const timer = window.setInterval(async () => {
      try {
        const current = await provider.getJob(job.id);
        setJob(current);
        if (current.status === 'completed') setArtifacts(await provider.getArtifacts(job.id));
        if (current.status === 'failed') setError(current.error ?? 'The bake failed.');
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not check the job.');
        setJob(null);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  async function submit(event: Event) {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError('');
    setArtifacts([]);
    setJob(null);
    try {
      const started = await provider.bakeScene({ file }, { quality });
      setJob(started);
      if (started.status === 'completed') setArtifacts(await provider.getArtifacts(started.id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not request the bake.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header class="topbar">
        <a class="brand" href="#top"><span class="brand-mark">✳</span> LIGHTBAKER</a>
        <nav><a href="#showcase">Showcase</a><a href="#studio">Bake studio</a><a href="https://github.com/Ibrahim-3d/three-lightmap-baker">WebGL OSS</a></nav>
      </header>
      <section class="hero" id="top">
        <div class="eyebrow">LIGHTING FOR THE NEXT SCENE</div>
        <h1>Bring your scene<br /><em>into the light.</em></h1>
        <p>Explore the original LightBaker results and a simple interface for requesting a hosted bake.</p>
        <a class="button primary" href="#studio">Open bake studio <span>↗</span></a>
        <div class="hero-image"><img src={`${source}after-production-baked-combined.png`} alt="Cornell scene with baked lighting" /></div>
      </section>
      <section class="showcase section" id="showcase">
        <div class="section-heading"><div><div class="eyebrow">FROM THE ORIGINAL PLAYGROUND</div><h2>One scene. Three views.</h2></div><p>The reference gallery is preserved from the public WebGL demo.</p></div>
        <div class="gallery">{examples.map((item, i) => <article class="tile" key={item.image}><div class="tile-image"><img src={`${source}${item.image}`} alt={item.title} loading="lazy" /></div><div class="tile-meta"><span>0{i + 1} / {item.caption}</span><h3>{item.title}</h3></div></article>)}</div>
      </section>
      <section class="studio section" id="studio">
        <div class="section-heading"><div><div class="eyebrow">BAKE STUDIO</div><h2>Scene in. Light out.</h2></div><p>Upload a GLB scene and track the job through a single product API.</p></div>
        <div class="studio-grid">
          <form class="panel" onSubmit={submit}>
            <div class="panel-label">01 / SCENE</div>
            <label class="dropzone"><span class="upload-icon">↥</span><strong>{file?.name ?? 'Choose a GLB scene'}</strong><small>{file ? `${(file.size / 1_000_000).toFixed(2)} MB selected` : 'GLB format · click to browse'}</small><input type="file" accept=".glb,model/gltf-binary" onChange={e => setFile(e.currentTarget.files?.[0] ?? null)} /></label>
            <div class="panel-label space">02 / QUALITY</div>
            <div class="segmented"><button type="button" class={quality === 'preview' ? 'selected' : ''} onClick={() => setQuality('preview')}>Preview</button><button type="button" class={quality === 'production' ? 'selected' : ''} onClick={() => setQuality('production')}>Production</button></div>
            <button class="button primary submit" type="submit" disabled={!file || busy}>{busy ? 'Requesting…' : liveApi ? 'Start bake' : 'Show sample result'} <span>↗</span></button>
            {!liveApi && <p class="notice">Sample mode: your file stays in this browser. This displays an existing example image; it does not bake your scene.</p>}
            {error && <p class="error" role="alert">{error}</p>}
          </form>
          <div class="panel result-panel"><div class="panel-label">03 / RESULT</div>{artifacts.length ? <><div class="result-image"><img src={artifacts[0].url} alt={artifacts[0].name} /></div><div class="result-line"><span>{artifacts[0].name}</span>{liveApi && <a href={artifacts[0].url} target="_blank" rel="noreferrer">View artifact ↗</a>}</div></> : <div class="empty-result"><span>✳</span><strong>{job ? `${job.status.toUpperCase()} ${job.progress ?? 0}%` : 'Your result appears here'}</strong><small>{job ? `Job ${job.id}` : 'Choose a scene to begin.'}</small></div>}</div>
        </div>
      </section>
      <footer><span>LIGHTBAKER © {new Date().getFullYear()}</span><span>Original WebGL baker <a href="https://github.com/Ibrahim-3d/three-lightmap-baker">on GitHub ↗</a></span></footer>
    </main>
  );
}

render(<App />, document.getElementById('app')!);

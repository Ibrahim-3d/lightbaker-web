import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const API=(process.env.LIGHTBAKER_API_URL||"http://127.0.0.1:8787").replace(/\/$/,"");
const OUT=resolve("launch/output");
const HERE=resolve("launch");
const SCENES=["hero","game","lab"];

function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function mime(p){return extname(p)===".html"?"text/html":"application/octet-stream"}
const server=createServer(async(req,res)=>{try{const p=req.url?.startsWith("/scene.html")?join(HERE,"scene.html"):join(HERE,"scene.html");res.writeHead(200,{"content-type":mime(p)});res.end(await readFile(p))}catch(e){res.writeHead(500);res.end(String(e))}});
await new Promise(r=>server.listen(8765,"127.0.0.1",r));
await mkdir(OUT,{recursive:true});
const browser=await chromium.launch({headless:true});

async function saveBaseline(name){
  const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
  await page.goto(`http://127.0.0.1:8765/scene.html?scene=${name}`,{waitUntil:"networkidle"});
  await page.waitForFunction(()=>window.__ready===true);
  await page.screenshot({path:join(OUT,`${name}-before.png`)});
  const b64=await page.evaluate(()=>window.exportGLB());
  const glb=Buffer.from(b64,"base64");
  await writeFile(join(OUT,`${name}.glb`),glb);
  await page.close();
  return glb;
}

async function bake(name,glb){
  const submit=await fetch(`${API}/bakeScene?quality=production`,{method:"POST",headers:{"content-type":"model/gltf-binary"},body:glb});
  if(!submit.ok) throw new Error(`${name}: submit failed ${submit.status} ${await submit.text()}`);
  const job=await submit.json();
  const deadline=Date.now()+10*60_000;
  let state=job;
  while(state.status==="queued"||state.status==="running"){
    if(Date.now()>deadline) throw new Error(`${name}: bake timed out`);
    await sleep(1200);
    const r=await fetch(`${API}/getJob/${encodeURIComponent(job.id)}`);
    if(!r.ok) throw new Error(`${name}: getJob failed ${r.status}`);
    state=await r.json();
    console.log(name,state.status,state.progress??"");
  }
  if(state.status!=="completed") throw new Error(`${name}: bake ${state.status}: ${state.error||"unknown error"}`);
  const ar=await fetch(`${API}/getArtifacts/${encodeURIComponent(job.id)}`);
  if(!ar.ok) throw new Error(`${name}: getArtifacts failed ${ar.status}`);
  const artifacts=await ar.json();
  for(const a of artifacts){
    const url=new URL(a.url,API).href;
    const r=await fetch(url);
    if(!r.ok) throw new Error(`${name}: artifact ${a.kind} failed ${r.status}`);
    const bytes=Buffer.from(await r.arrayBuffer());
    const suffix=a.kind==="preview"?"after":a.kind;
    await writeFile(join(OUT,`${name}-${suffix}.png`),bytes);
  }
  return artifacts;
}

async function makeContactSheet(){
  const cards=[];
  for(const n of SCENES){
    for(const k of ["before","after","lightmap"]){
      try{const d=await readFile(join(OUT,`${n}-${k}.png`));cards.push({n,k,src:`data:image/png;base64,${d.toString("base64")}`})}catch{}
    }
  }
  const html=`<!doctype html><style>body{margin:0;background:#0b0d10;color:white;font:26px system-ui;padding:32px}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.c{background:#14181e;padding:10px;border-radius:14px}.c img{width:100%;display:block;border-radius:8px}.l{padding:10px 4px 2px;text-transform:uppercase;font-size:14px;letter-spacing:.08em;color:#aeb8c4}</style><div class=g>${cards.map(c=>`<div class=c><img src="${c.src}"><div class=l>${c.n} — ${c.k}</div></div>`).join("")}</div>`;
  const p=await browser.newPage({viewport:{width:1920,height:1400},deviceScaleFactor:1});
  await p.setContent(html,{waitUntil:"load"});
  await p.screenshot({path:join(OUT,"contact-sheet.png"),fullPage:true});
  await p.close();
}

try{
  console.log("LightBaker launch capture ->",OUT);
  console.log("API ->",API);
  for(const n of SCENES){
    console.log("\nGenerating",n);
    const glb=await saveBaseline(n);
    console.log("Baking",n);
    await bake(n,glb);
  }
  await makeContactSheet();
  console.log("\nDone. Assets:",OUT);
} finally {
  await browser.close();
  server.close();
}
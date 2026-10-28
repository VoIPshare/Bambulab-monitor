"use strict";
const DEMO = location.protocol === "file:" || new URLSearchParams(location.search).get("demo") === "1";
const REFRESH_MS = 2000;
const CAMERA_MS = 1000;
const FRAME_MS = 60000; // camera picture in the job tile: one still picture this often
const state = { filter: "all", printers: [], summary: null };
const $ = selector => document.querySelector(selector);

const demoPrinters = [
  {id:1,name:"X1 Carbon",ip:"192.168.1.123",connected:true,camera:true,platePreview:true,stale:false,reconnects:0,lastError:null,updatedAt:new Date().toISOString(),state:"RUNNING",file:"Benchy.3mf",progress:72,remainingMinutes:78,layer:142,totalLayers:198,nozzleTemp:220,nozzleTarget:220,bedTemp:60,bedTarget:60,chamberTemp:35,wifiSignal:"-55dBm",speedLevel:2,printError:0,hmsCount:0,activeTray:"0",startedAt:new Date(Date.now()-63*60000).toISOString(),fans:{part:100,aux:100,exhaust:40},ams:[
    {unitId:0,slotId:0,color:"#161616",type:"PLA",material:"PLA Basic",remaining:78,humidity:2,humidityPercent:47,temperature:29,loaded:true,active:true},
    {unitId:0,slotId:1,color:"#f4f4f4",type:"PLA",material:"PLA Matte",remaining:45,humidity:2,humidityPercent:47,temperature:29,loaded:true,active:false},
    {unitId:0,slotId:2,color:"#2775d8",type:"PETG",material:"PETG HF",remaining:62,humidity:2,humidityPercent:47,temperature:29,loaded:true,active:false},
    {unitId:0,slotId:3,color:"#666666",type:null,material:null,remaining:null,humidity:2,humidityPercent:47,temperature:29,loaded:false,active:false}
  ],raw:{print:{gcode_state:"RUNNING",mc_percent:72}}},
  {id:2,name:"P1S Workshop",ip:"192.168.1.124",connected:false,camera:true,platePreview:false,stale:true,reconnects:2,lastError:null,updatedAt:null,state:null,file:null,progress:null,remainingMinutes:null,layer:null,totalLayers:null,nozzleTemp:null,nozzleTarget:null,bedTemp:null,bedTarget:null,chamberTemp:null,wifiSignal:null,speedLevel:null,printError:null,hmsCount:0,activeTray:null,ams:[],raw:null}
];

// Stand-in plate image for the standalone preview.
const DEMO_MODEL="data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><path d="M20 140 100 180 180 140 100 100Z" fill="#3a3f47"/><path d="M60 120V70l40-20 40 20v50l-40 20z" fill="#e8e8e8"/><path d="M60 70l40 20 40-20-40-20z" fill="#fff"/><path d="M100 90v50l40-20V70z" fill="#bdbdbd"/></svg>');
const CAMERA_SIZES = {off:()=>t("camOff"),s:()=>"S",m:()=>"M",l:()=>"L"};
function stored(key){ try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } }
const cameraSizes = stored("cameraSizes");
const tileViews = stored("tileViews");
const TILE_QUIET_MS = 10000; // hide the tile's switch and time label this long after the mouse leaves
const tileActiveAt = {};
function esc(value){ return String(value ?? "—").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function number(value, fallback=0){ const n=Number(value); return Number.isFinite(n)?n:fallback; }
function clamp(value,min,max){ return Math.min(max,Math.max(min,value)); }
function remaining(minutes){ const n=Number(minutes); if(minutes==null||!Number.isFinite(n)) return "—"; const h=Math.floor(n/60),m=Math.round(n%60); return h?`${h}h ${m}m`:`${m} min`; }
function clock(date){ return date.toLocaleTimeString(lang, {hour:"2-digit",minute:"2-digit"}); }
function doneAt(minutes){ const n=Number(minutes); return minutes==null||!Number.isFinite(n)||n<=0?"—":clock(new Date(Date.now()+n*60000)); }
function age(iso){ if(!iso)return t("never"); const s=Math.max(0,Math.floor((Date.now()-Date.parse(iso))/1000)); if(s<60)return t("secondsAgo",{n:s}); if(s<3600)return t("minutesAgo",{n:Math.floor(s/60)}); return t("hoursAgo",{n:Math.floor(s/3600)}); }
function printing(value){ return ["RUNNING","PRINTING","PREPARE","PAUSE","SLICING"].includes(String(value||"").toUpperCase()); }
function hasError(value){ return ![null,undefined,"",0,"0"].includes(value); }
// Card theme (accent colour) and the label in the status pill.
function status(p){
  const s=String(p.state||"").toUpperCase();
  if(!p.connected) return ["offline",t("stOffline")];
  if(hasError(p.printError)||s==="FAILED") return ["error",t(s==="FAILED"?"stFailed":"stError")];
  if(s==="PAUSE") return ["paused",t("stPaused")];
  if(s==="PREPARE"||s==="SLICING") return ["printing",t("stPreparing")];
  if(printing(s)) return ["printing",t("stPrinting")];
  if(s==="FINISH") return ["idle",t("stFinished")];
  return ["idle",p.stale?t("stQuiet",{age:age(p.updatedAt)}):t("stIdle")];
}
function ring(percent,layer,total){
  const r=44, c=2*Math.PI*r;
  const layers=layer==null&&total==null?"":`<div class="ring-layer">${esc(t("layer",{n:layer??"—",total:total??"—"}))}</div>`;
  return `<div class="ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="${r}"/><circle class="fill" cx="50" cy="50" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c*(1-(percent??0)/100)}"/></svg><div class="ring-center"><div class="ring-pct">${percent==null?"—":esc(Math.round(percent))+"%"}</div>${layers}</div></div>`;
}
function temp(name,current,target,cls){
  const heating=target!=null&&target>0;
  const now=`<span class="${cls||(heating?"hot":"")}">${current==null?"—":esc(Math.round(current))+"°"}</span>`;
  return `<div class="temp"><div class="temp-value">${now}${heating?` <span class="target">/ ${esc(Math.round(target))}</span>`:""}</div><div class="temp-label">${name}</div></div>`;
}
// Very dark filament would vanish on the dark track, so give its bar a neutral grey.
function barColor(hex){ const m=/^#?([0-9a-f]{6})/i.exec(hex||""); if(!m) return "#9aa3ad"; const n=parseInt(m[1],16); const l=(0.299*(n>>16)+0.587*(n>>8&255)+0.114*(n&255))/255; return l<0.2?"#9aa3ad":"#"+m[1]; }
function renderSlot(s){
  if(!s.loaded) return `<div class="ams-slot empty-slot"><span class="swatch none"></span><div class="ams-type">${t("empty")}</div><div class="ams-meta">${t("slot",{n:number(s.slotId)+1})}</div><div class="ams-bar"></div></div>`;
  const left=s.remaining==null?"":`${esc(s.remaining)}%`;
  const meta=[left,s.active?t("inUse"):""].filter(Boolean).join(" · ")||esc(s.material||"");
  return `<div class="ams-slot ${s.active?"active":""}" title="${esc(s.material||s.type)}"><span class="swatch" style="background:${esc(s.color||"#666")}"></span><div class="ams-type">${esc(s.type||s.material||t("loaded"))}</div><div class="ams-meta">${meta}</div><div class="ams-bar"><div style="width:${clamp(number(s.remaining),0,100)}%;background:${barColor(s.color)}"></div></div></div>`;
}
function renderAMS(slots){
  if(!slots?.length) return "";
  const units=[...new Set(slots.map(s=>s.unitId))];
  return `<section class="section">${units.map(unit=>{
    const unitSlots=slots.filter(s=>s.unitId===unit), first=unitSlots[0];
    const humidity=first.humidityPercent!=null?esc(t("rh",{n:first.humidityPercent})):first.humidity!=null?esc(t("humidityLevel",{n:first.humidity})):"";
    const env=[humidity,first.temperature!=null?`${esc(first.temperature)}°C`:""].filter(Boolean).join(" · ");
    return `<div class="section-head"><span class="section-label">${t("ams")}${units.length>1?" "+esc(number(unit)+1):""}</span><span class="ams-env">${env}</span></div><div class="ams-grid">${unitSlots.map(renderSlot).join("")}</div>`;
  }).join("")}</section>`;
}
function renderFans(f){
  const fans=[[t("fanPart"),f?.part],[t("fanAux"),f?.aux],[t("fanExhaust"),f?.exhaust]].filter(([,v])=>v!=null);
  return fans.length?`<div class="fans">${fans.map(([label,v])=>`<span>${label} <strong>${esc(v)}%</strong></span>`).join("")}</div>`:"";
}
function renderCamera(p){
  if(!p.camera) return "";
  const size=CAMERA_SIZES[cameraSizes[p.id]]?cameraSizes[p.id]:"l";
  const message=t(DEMO?"cameraDemo":"cameraConnecting");
  const picker=Object.entries(CAMERA_SIZES).map(([key,label])=>`<button type="button" class="${key===size?"active":""}" data-camera-size="${key}" data-printer="${p.id}" aria-pressed="${key===size}">${esc(label())}</button>`).join("");
  // Keyed by size too, so a new size gets a fresh node with the right class.
  return `<section class="section"><div class="section-head"><span class="section-label camera-title">${t("camera")}<span class="live-label">${t("live")}</span></span><div class="size-picker" role="group" aria-label="${t("cameraSize")}">${picker}</div></div>${size==="off"?"":`<div class="camera size-${size}" data-keep="camera-${p.id}-${size}" data-camera="${p.id}"><img alt="${esc(t("cameraOf",{name:p.name}))}" hidden><div class="camera-msg">${message}</div><span class="live-badge">${t("live")}</span></div>`}</section>`;
}
// The tile next to the job shows either the model picture or a camera still that refreshes every FRAME_MS.
// The model picture comes from the job's .3mf, so it only exists for jobs stored on the printer.
function renderTile(p){
  const views=[p.platePreview&&p.file?"model":null,p.camera?"frame":null].filter(Boolean);
  if(!views.length) return "";
  const view=views.includes(tileViews[p.id])?tileViews[p.id]:views[0];
  const toggle=views.length<2?"":`<div class="size-picker tile-toggle" role="group" aria-label="${t("tileShow")}">${views.map(key=>`<button type="button" class="${key===view?"active":""}" data-tile-view="${key}" data-printer="${p.id}" aria-pressed="${key===view}">${t(key==="model"?"tileModel":"tileCamera")}</button>`).join("")}</div>`;
  const content=view==="model"
    ?`<div class="model" data-keep="preview-${p.id}-${esc(p.file)}" data-preview="${p.id}"><span class="model-msg">${t("loadingPreview")}</span></div>`
    :`<div class="model frame" data-keep="frame-${p.id}" data-camera="${p.id}" data-mode="frame" title="${t("enlarge")}"><img alt="${esc(t("cameraOf",{name:p.name}))}" hidden><div class="camera-msg">${t(DEMO?"cameraDemo":"cameraConnecting")}</div><div class="camera-time" hidden></div></div>`;
  tileActiveAt[p.id]??=Date.now();
  return `<div class="tile${tileQuiet(p.id)?" quiet":""}" data-tile="${p.id}">${content}${toggle}</div>`;
}
function tileQuiet(id){ return Date.now()-tileActiveAt[id]>TILE_QUIET_MS; }
function updateTiles(){ document.querySelectorAll("[data-tile]").forEach(el=>el.classList.toggle("quiet",tileQuiet(el.dataset.tile))); }
function renderPrinter(p){
  const [theme,label]=status(p), active=printing(p.state);
  const percent=p.progress==null?null:clamp(number(p.progress),0,100);
  const alert = !p.connected && p.lastError ? `<div class="alert">${esc(p.lastError)}</div>` : "";
  const started=p.startedAt&&active?clock(new Date(p.startedAt)):"—";
  return `<article class="printer ${theme}"><div class="printer-head"><div class="printer-name"><span>${esc(p.name)}</span><span class="printer-ip">${esc(p.ip)}</span></div><span class="pill">${esc(label)}</span></div>${alert}<div class="hero">${ring(percent,p.layer,p.totalLayers)}<div style="min-width:0"><div class="job" title="${esc(p.file)}">${esc(p.file||t("noJob"))}</div><div class="left"><span class="left-time">${esc(active?remaining(p.remainingMinutes):"—")}</span>${active?`<span class="left-label">${t("left")}</span>`:""}</div><dl class="times"><dt>${t("doneAt")}</dt><dd>${esc(active?doneAt(p.remainingMinutes):"—")}</dd><dt>${t("started")}</dt><dd>${esc(started)}</dd></dl></div>${renderTile(p)}</div><div class="temps">${temp(t("nozzle"),p.nozzleTemp,p.nozzleTarget)}${temp(t("bed"),p.bedTemp,p.bedTarget)}${temp(t("chamber"),p.chamberTemp,null,"chamber")}</div>${renderAMS(p.ams)}${renderFans(p.fans)}${renderCamera(p)}<details><summary>${t("details")}</summary><div class="details"><div class="detail"><span>${t("state")}</span><strong>${esc(p.state||(p.connected?t("waiting"):"—"))}</strong></div><div class="detail"><span>${t("lastReport")}</span><strong>${esc(age(p.updatedAt))}</strong></div><div class="detail"><span>${t("wifi")}</span><strong>${esc(p.wifiSignal)}</strong></div><div class="detail"><span>${t("speed")}</span><strong>${esc(I18N.en["speed"+p.speedLevel]?t("speed"+p.speedLevel):p.speedLevel)}</strong></div><div class="detail"><span>${t("printError")}</span><strong>${esc(p.printError)}</strong></div><div class="detail"><span>${t("hms")}</span><strong>${esc(p.hmsCount)}</strong></div><div class="detail"><span>${t("reconnects")}</span><strong>${esc(p.reconnects)}</strong></div></div>${p.raw===undefined?"":`<pre>${esc(p.raw==null?t("noReport"):JSON.stringify(p.raw,null,2))}</pre>`}</details></article>`;
}
function calculateSummary(printers){ return {online:printers.filter(p=>p.connected).length,total:printers.length,activePrints:printers.filter(p=>printing(p.state)).length,amsSlots:printers.flatMap(p=>p.ams||[]).filter(s=>s.loaded).length,errors:printers.filter(p=>hasError(p.printError)).length,historyEnabled:false}; }
function renderSummary(s){ $("#summary").innerHTML=[[t("sumOnline"),`${s.online} / ${s.total}`],[t("sumActive"),s.activePrints],[t("sumAms"),s.amsSlots],[t("sumErrors"),s.errors],[t("sumHistory"),t(s.historyEnabled?"on":"off")]].map(([label,value])=>`<div class="summary-card"><div class="label">${label}</div><div class="number">${esc(value)}</div></div>`).join(""); }
// Camera and preview nodes survive re-renders so the images don't flicker or reload.
function keepNodes(update){
  const saved=new Map([...document.querySelectorAll("[data-keep]")].map(el=>[el.dataset.keep,el]));
  update();
  document.querySelectorAll("[data-keep]").forEach(el=>{ const old=saved.get(el.dataset.keep); if(old&&old!==el) el.replaceWith(old); });
}
function render(){
  const f=state.filter;
  const filtered=state.printers.filter(p=>f==="all"||(f==="printing"&&printing(p.state))||(f==="offline"&&!p.connected)||(f==="error"&&hasError(p.printError)));
  // Keep the order from config.json so cards don't jump around.
  keepNodes(()=>{ $("#printers").innerHTML=filtered.length?[...filtered].sort((a,b)=>a.id-b.id).map(renderPrinter).join(""):`<div class="empty">${t("noMatch")}</div>`; });
  renderSummary(state.summary||calculateSummary(state.printers));
  const active=state.printers.filter(p=>printing(p.state)).length;
  document.title = active ? t("tabPrinting",{n:active}) : "Bambu LAN Monitor";
}
async function refresh(){
  try{
    if(DEMO){ state.printers=demoPrinters; state.summary=calculateSummary(demoPrinters); $("#demoBanner").textContent=t("demoBanner"); $("#demoBanner").style.display="block"; }
    else {
      const [statuses,summary]=await Promise.all([fetch("/api/status",{cache:"no-store"}),fetch("/api/summary",{cache:"no-store"})]);
      if(!statuses.ok||!summary.ok)throw new Error(`HTTP ${statuses.status}/${summary.status}`);
      state.printers=await statuses.json(); state.summary=await summary.json();
      $("#demoBanner").style.display="none";
    }
    // Don't wipe an open "Raw MQTT report" panel on every refresh.
    if(!document.querySelector("details[open]")) render(); else renderSummary(state.summary);
    $("#refresh").textContent=t("updated",{time:new Date().toLocaleTimeString(lang)});
  }catch(error){
    $("#refresh").textContent=t("backendDown");
    $("#demoBanner").textContent=t("apiDown",{error:error.message});
    $("#demoBanner").style.display="block";
  }
}
async function errorText(response){ try { return (await response.json()).error; } catch { return `HTTP ${response.status}`; } }
async function updateCamera(el){
  const img=el.querySelector("img"), msg=el.querySelector(".camera-msg");
  const show=text=>{ img.hidden=!!text; msg.hidden=!text; if(text) msg.textContent=text; };
  const response=await fetch(`/api/camera/${el.dataset.camera}.jpg`,{cache:"no-store"});
  // In frame mode the stream is off between pictures, so keep the last one while it reconnects.
  if(!response.ok){ const error=await errorText(response); if(!(el.dataset.mode==="frame"&&el.dataset.url)) show(error); return; }
  const url=URL.createObjectURL(await response.blob());
  img.onload=()=>{
    if(el.dataset.url) URL.revokeObjectURL(el.dataset.url);
    el.dataset.url=url; show("");
    if(el.dataset.mode!=="frame") return;
    el.dataset.nextAt=Date.now()+FRAME_MS;
    const time=el.querySelector(".camera-time"); time.hidden=false; time.textContent=t("frameAt",{time:clock(new Date())});
  };
  img.src=url;
}
async function updatePreview(el){
  el.dataset.state="loading";
  const response=await fetch(`/api/preview/${el.dataset.preview}.png`,{cache:"no-store"});
  if(!response.ok){
    const error=await errorText(response), loading=error.startsWith("Loading");
    // Shrink to a one-line note with the reason instead of an empty picture frame.
    if(!loading){ el.classList.add("unavailable"); el.innerHTML=`<span class="model-msg"><strong>${t("noPreview")}</strong> · ${esc(error)}</span>`; }
    // 503 while the daemon is still downloading the .3mf; retry later.
    setTimeout(()=>delete el.dataset.state, loading?3000:30000);
    return;
  }
  showModel(el,URL.createObjectURL(await response.blob()));
}
function showModel(el,src){
  el.classList.remove("unavailable");
  el.innerHTML=`<button type="button" class="model-open" title="${t("enlarge")}"><img alt="${t("platePreview")}" src="${src}"></button>`;
  el.dataset.state="done";
}
const cameraBusy=new WeakSet();
function updateMedia(){
  if(DEMO){ document.querySelectorAll("[data-preview]:not([data-state])").forEach(el=>showModel(el,DEMO_MODEL)); return; }
  if(document.hidden) return;
  document.querySelectorAll("[data-camera]").forEach(el=>{
    if(cameraBusy.has(el)||Date.now()<number(el.dataset.nextAt)) return;
    cameraBusy.add(el);
    updateCamera(el).catch(()=>{}).finally(()=>cameraBusy.delete(el));
  });
  document.querySelectorAll("[data-preview]:not([data-state])").forEach(el=>updatePreview(el).catch(()=>delete el.dataset.state));
}
// The 10 s countdown restarts whenever the mouse leaves a tile; CSS shows the text again on hover.
$("#printers").addEventListener("mouseout",event=>{
  const tile=event.target.closest("[data-tile]");
  if(tile&&!tile.contains(event.relatedTarget)) tileActiveAt[tile.dataset.tile]=Date.now();
});
$("#printers").addEventListener("click",event=>{
  const model=event.target.closest(".tile img");
  if(model){ $("#modelImage").src=model.src; $("#modelDialog").showModal(); return; }
  const tileButton=event.target.closest("[data-tile-view]");
  if(tileButton){
    tileViews[tileButton.dataset.printer]=tileButton.dataset.tileView;
    try { localStorage.setItem("tileViews",JSON.stringify(tileViews)); } catch {}
    render(); updateMedia(); return;
  }
  const button=event.target.closest("[data-camera-size]"); if(!button) return;
  cameraSizes[button.dataset.printer]=button.dataset.cameraSize;
  try { localStorage.setItem("cameraSizes",JSON.stringify(cameraSizes)); } catch {}
  render();
});
$("#filter").addEventListener("change",event=>{state.filter=event.target.value;render();});
$("#lang").value=lang;
$("#lang").addEventListener("change",event=>{ setLanguage(event.target.value); refresh(); });
$("#refreshButton").addEventListener("click",()=>{ document.querySelectorAll("details[open]").forEach(d=>d.open=false); refresh(); });
$("#modelDialog").addEventListener("click",()=>$("#modelDialog").close());
applyStaticText(); refresh(); updateMedia(); setInterval(updateTiles,1000); if(!DEMO){ setInterval(refresh,REFRESH_MS); setInterval(updateMedia,CAMERA_MS); }

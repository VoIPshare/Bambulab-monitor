"use strict";
const DEMO = location.protocol === "file:" || new URLSearchParams(location.search).get("demo") === "1";
const REFRESH_MS = 2000;
const state = { filter: "all", printers: [], summary: null };
const $ = selector => document.querySelector(selector);

const demoPrinters = [
  {id:1,name:"X1 Carbon",ip:"192.168.1.123",connected:true,stale:false,reconnects:0,lastError:null,updatedAt:new Date().toISOString(),state:"RUNNING",file:"Benchy.3mf",progress:72,remainingMinutes:78,layer:142,totalLayers:198,nozzleTemp:220,nozzleTarget:220,bedTemp:60,bedTarget:60,chamberTemp:35,wifiSignal:"-55dBm",speedLevel:2,printError:0,hmsCount:0,activeTray:"0",ams:[
    {unitId:0,slotId:0,color:"#161616",type:"PLA",material:"PLA Basic",remaining:78,humidity:2,temperature:26,loaded:true,active:true},
    {unitId:0,slotId:1,color:"#f4f4f4",type:"PLA",material:"PLA Matte",remaining:45,humidity:2,temperature:26,loaded:true,active:false},
    {unitId:0,slotId:2,color:"#2775d8",type:"PETG",material:"PETG HF",remaining:62,humidity:2,temperature:26,loaded:true,active:false},
    {unitId:0,slotId:3,color:"#666666",type:null,material:null,remaining:null,humidity:2,temperature:26,loaded:false,active:false}
  ],raw:{print:{gcode_state:"RUNNING",mc_percent:72}}},
  {id:2,name:"P1S Workshop",ip:"192.168.1.124",connected:false,stale:true,reconnects:2,lastError:null,updatedAt:null,state:null,file:null,progress:null,remainingMinutes:null,layer:null,totalLayers:null,nozzleTemp:null,nozzleTarget:null,bedTemp:null,bedTarget:null,chamberTemp:null,wifiSignal:null,speedLevel:null,printError:null,hmsCount:0,activeTray:null,ams:[],raw:null}
];

const SPEED = {1:"Silent",2:"Standard",3:"Sport",4:"Ludicrous"};
function esc(value){ return String(value ?? "—").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function number(value, fallback=0){ const n=Number(value); return Number.isFinite(n)?n:fallback; }
function clamp(value,min,max){ return Math.min(max,Math.max(min,value)); }
function remaining(minutes){ const n=Number(minutes); if(minutes==null||!Number.isFinite(n)) return "—"; const h=Math.floor(n/60),m=Math.round(n%60); return h?`${h}h ${m}m`:`${m} min`; }
function eta(minutes){ const n=Number(minutes); if(minutes==null||!Number.isFinite(n)||n<=0) return ""; return "ETA "+new Date(Date.now()+n*60000).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}); }
function age(iso){ if(!iso)return "Never"; const s=Math.max(0,Math.floor((Date.now()-Date.parse(iso))/1000)); if(s<60)return `${s}s ago`; if(s<3600)return `${Math.floor(s/60)}m ago`; return `${Math.floor(s/3600)}h ago`; }
function printing(value){ return ["RUNNING","PRINTING","PREPARE","PAUSE","SLICING"].includes(String(value||"").toUpperCase()); }
function hasError(value){ return ![null,undefined,"",0,"0"].includes(value); }
function badge(p){
  if(!p.connected) return '<span class="badge offline">Offline</span>';
  if(hasError(p.printError)) return '<span class="badge offline">Error</span>';
  if(p.stale) return `<span class="badge stale" title="Connected, no update for a while">Quiet · ${esc(age(p.updatedAt))}</span>`;
  if(String(p.state||"").toUpperCase()==="PAUSE") return '<span class="badge stale">Paused</span>';
  return '<span class="badge online">Online</span>';
}
function tempColor(value){ const n=number(value); return n>=200?"#ff727e":n>=70?"#ffbd59":"#52d6a0"; }
function gauge(name,current,target,max){ const currentText=current==null?"—":`${current}°C`; const targetText=target==null||target===0?"":` / ${target}°C`; return `<div class="gauge"><div class="label">${name}</div><div class="value">${esc(currentText)}<span class="muted">${esc(targetText)}</span></div><div class="gauge-track"><div class="gauge-fill" style="width:${clamp(number(current)/max*100,0,100)}%;background:${tempColor(current)}"></div></div></div>`; }
function renderAMS(slots){ if(!slots?.length)return '<div class="empty">No AMS data reported.</div>'; return `<div class="ams-grid">${slots.map(s=>`<div class="ams-slot ${s.active?"active":""}"><div class="ams-title"><span class="swatch" style="background:${esc(s.color||"#666")}"></span><strong>AMS ${esc(number(s.unitId)+1)} · Slot ${esc(number(s.slotId)+1)}</strong></div><div class="value">${s.loaded?esc(s.type||s.material||"Loaded"):"Empty"}</div><div class="muted">${s.loaded?`${esc(s.material||"")}${s.remaining!=null?` · ${esc(s.remaining)}% left`:""}`:"No filament"}</div><div class="muted">Humidity ${esc(s.humidity)} · ${s.temperature==null?"—":esc(s.temperature)+"°C"}</div></div>`).join("")}</div>`; }
function renderPrinter(p){
  const percent=clamp(number(p.progress),0,100);
  const alert = !p.connected && p.lastError ? `<div class="alert">${esc(p.lastError)}</div>` : "";
  return `<article class="printer"><div class="printer-head"><div><div class="printer-name">${esc(p.name)}</div><div class="muted">${esc(p.ip)}</div></div>${badge(p)}</div><div class="printer-body">${alert}<div class="hero"><div class="printer-icon" aria-hidden="true">▣</div><div><div class="label">Current job</div><div class="job">${esc(p.file||"No active job")}</div><div class="value">${p.progress==null?"—":esc(percent)+"%"} <span class="muted small">${esc(printing(p.state)?eta(p.remainingMinutes):"")}</span></div><div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div></div></div><div class="metric-grid"><div class="metric"><div class="label">State</div><div class="value">${esc(p.state||(p.connected?"Waiting":"—"))}</div></div><div class="metric"><div class="label">Time remaining</div><div class="value">${esc(printing(p.state)?remaining(p.remainingMinutes):"—")}</div></div><div class="metric"><div class="label">Layers</div><div class="value">${esc(p.layer)} / ${esc(p.totalLayers)}</div></div><div class="metric"><div class="label">Last report</div><div class="value">${esc(age(p.updatedAt))}</div></div></div><section class="section"><h3>Temperatures</h3><div class="gauges">${gauge("Nozzle",p.nozzleTemp,p.nozzleTarget,300)}${gauge("Bed",p.bedTemp,p.bedTarget,120)}${gauge("Chamber",p.chamberTemp,null,80)}</div></section><section class="section"><h3>AMS</h3>${renderAMS(p.ams)}</section><section class="section"><h3>Details</h3><div class="details"><div class="detail"><span>Wi-Fi</span><strong>${esc(p.wifiSignal)}</strong></div><div class="detail"><span>Speed</span><strong>${esc(SPEED[p.speedLevel]||p.speedLevel)}</strong></div><div class="detail"><span>Print error</span><strong>${esc(p.printError)}</strong></div><div class="detail"><span>HMS alerts</span><strong>${esc(p.hmsCount)}</strong></div><div class="detail"><span>Reconnects</span><strong>${esc(p.reconnects)}</strong></div></div></section><details><summary>Raw MQTT report</summary><pre>${esc(p.raw==null?"No report received":JSON.stringify(p.raw,null,2))}</pre></details></div></article>`;
}
function calculateSummary(printers){ return {online:printers.filter(p=>p.connected).length,total:printers.length,activePrints:printers.filter(p=>printing(p.state)).length,amsSlots:printers.flatMap(p=>p.ams||[]).filter(s=>s.loaded).length,errors:printers.filter(p=>hasError(p.printError)).length,historyEnabled:false}; }
function renderSummary(s){ $("#summary").innerHTML=[["Online",`${s.online} / ${s.total}`],["Active prints",s.activePrints],["AMS slots loaded",s.amsSlots],["Errors",s.errors],["History",s.historyEnabled?"On":"Off"]].map(([label,value])=>`<div class="summary-card"><div class="label">${label}</div><div class="number">${esc(value)}</div></div>`).join(""); }
function render(){
  const f=state.filter;
  const filtered=state.printers.filter(p=>f==="all"||(f==="printing"&&printing(p.state))||(f==="offline"&&!p.connected)||(f==="error"&&hasError(p.printError)));
  // Keep the order from config.json so cards don't jump around.
  $("#printers").innerHTML=filtered.length?[...filtered].sort((a,b)=>a.id-b.id).map(renderPrinter).join(""):'<div class="empty">No printers match this filter.</div>';
  renderSummary(state.summary||calculateSummary(state.printers));
  const active=state.printers.filter(p=>printing(p.state)).length;
  document.title = active ? `(${active} printing) Bambu LAN Monitor` : "Bambu LAN Monitor";
}
async function refresh(){
  try{
    if(DEMO){ state.printers=demoPrinters; state.summary=calculateSummary(demoPrinters); $("#demoBanner").textContent="Standalone preview mode with sample data. Start server.py for live printer data."; $("#demoBanner").style.display="block"; }
    else {
      const [statuses,summary]=await Promise.all([fetch("/api/status",{cache:"no-store"}),fetch("/api/summary",{cache:"no-store"})]);
      if(!statuses.ok||!summary.ok)throw new Error(`HTTP ${statuses.status}/${summary.status}`);
      state.printers=await statuses.json(); state.summary=await summary.json();
      $("#demoBanner").style.display="none";
    }
    // Don't wipe an open "Raw MQTT report" panel on every refresh.
    if(!document.querySelector("details[open]")) render(); else renderSummary(state.summary);
    $("#refresh").textContent=`Updated ${new Date().toLocaleTimeString()}`;
  }catch(error){
    $("#refresh").textContent="Backend unavailable";
    $("#demoBanner").textContent=`Live API unavailable (${error.message}). Is server.py running?`;
    $("#demoBanner").style.display="block";
  }
}
$("#filter").addEventListener("change",event=>{state.filter=event.target.value;render();});
$("#refreshButton").addEventListener("click",()=>{ document.querySelectorAll("details[open]").forEach(d=>d.open=false); refresh(); });
refresh(); if(!DEMO)setInterval(refresh,REFRESH_MS);

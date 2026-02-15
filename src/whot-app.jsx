import { useState, useEffect, useRef, useCallback } from "react";

// ═══ CONTRACT ═══
const V2="0x7b64ef47ee33DFD20aD0e1Bf92ddd3322559689e"; 
const WHOT_TOKEN="0x453C3a58Dd6bA56Cf87A7C3E98960F78FF037777"; 
const RPC_URLS=["https://rpc.monad.xyz","https://rpc1.monad.xyz","https://rpc2.monad.xyz","https://rpc3.monad.xyz","https://rpc-mainnet.monadinfra.com"];
const RPC=RPC_URLS[0];
const CHAIN_ID="0x8f";
const CHAIN_CFG={chainId:CHAIN_ID,chainName:"Monad",rpcUrls:["https://rpc.monad.xyz","https://rpc1.monad.xyz"],nativeCurrency:{name:"MON",symbol:"MON",decimals:18},blockExplorerUrls:["https://monadvision.com","https://monadscan.com"]};
const ABI=[
  "function createMatch(uint256,uint256) returns (uint256)",
  "function joinMatch(uint256)",
  "function resolveMatch(uint256,address,uint8,uint256[],bytes32)",
  "function cancelMatch(uint256)",
  "function getMatch(uint256) view returns (tuple(uint256 id,uint256 maxPlayers,uint256 currentPlayers,uint256 wagerPerPlayer,address[] players,address winner,uint256 winnerScore,uint8 state,uint8 winCondition,uint256 createdAt,uint256 resolvedAt,bytes32 gameHash))",
  "function getPlayerStats(address) view returns (tuple(uint256 wins,uint256 losses,uint256 totalWagered,uint256 totalWon,uint256 totalLost,uint256 gamesPlayed))",
  "function getOpenMatches() view returns (uint256[])",
  "function matchCount() view returns (uint256)",
  "event PlayerJoined(uint256 indexed matchId, address indexed player, uint256 currentPlayers)",
];
const ERC20_ABI=[
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];
function E(){return window.ethers}
function noEns(p){p.resolveName=async(n)=>n;p.getResolver=async()=>null;return p}
async function connectWallet(){
  if(!window.ethereum)throw new Error("Install MetaMask");
  const e=E();
  await window.ethereum.request({method:"eth_requestAccounts"});
  const curChain=await window.ethereum.request({method:"eth_chainId"});
  if(curChain!==CHAIN_ID){
    try{await window.ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:CHAIN_ID}]})}
    catch(x){
      if(x.code===4902||x.code===-32603){
        try{await window.ethereum.request({method:"wallet_addEthereumChain",params:[CHAIN_CFG]})}
        catch(a){console.warn("Add chain failed:",a)}
      }
    }
  }
  const p=noEns(new e.BrowserProvider(window.ethereum)),s=await p.getSigner();
  return{provider:p,signer:s,address:await s.getAddress()}
}
function con(s){return new(E()).Contract(V2,ABI,s)}
function readCon(){try{return con(noEns(new(E()).JsonRpcProvider(RPC)))}catch{return null}}
function tokenCon(s){return new(E()).Contract(WHOT_TOKEN,ERC20_ABI,s)}
function readTokenCon(){try{return tokenCon(noEns(new(E()).JsonRpcProvider(RPC)))}catch{return null}}
function fmt(w){return E().formatEther(w)}
function pw(m){return E().parseEther(m)}
function sa(a){return a?a.slice(0,6)+"..."+a.slice(-4):""}

// ═══ LOCAL STORAGE HELPERS ═══
const LS_KEY="whot_closed_"+V2.slice(0,10).toLowerCase();
function getClosedMatches(){try{return JSON.parse(localStorage.getItem(LS_KEY)||"{}")}catch{return{}}}
function markMatchClosed(id,reason){
  try{
    const m=getClosedMatches();
    m[id]={closed:true,reason,at:Date.now()};
    localStorage.setItem(LS_KEY,JSON.stringify(m));
  }catch{}
}
function isMatchClosed(id){const m=getClosedMatches();return !!m[id]?.closed}

function getAgentRegistry(){try{return JSON.parse(localStorage.getItem("whot_agent_names")||"{}")}catch{return{}}}
function getAgentNameByAddress(addr){if(!addr)return"";const r=getAgentRegistry();return r[addr.toLowerCase()]||r[addr]||""}
function getAgentName(addr){if(addr)return getAgentNameByAddress(addr);try{return localStorage.getItem("whot_agent_name")||""}catch{return""}}
function saveAgentName(name,addr){
  try{
    if(addr){const r=getAgentRegistry();r[addr.toLowerCase()]=name;localStorage.setItem("whot_agent_names",JSON.stringify(r))}
    localStorage.setItem("whot_agent_name",name);
  }catch{}
}

// ═══ ENGINE (deterministic: same matchId = same game on all clients) ═══
const SHAPES=["circle","square","triangle","cross"];
const SFX={1:{t:"draw",n:1},2:{t:"draw",n:2},3:{t:"draw",n:3},4:{t:"sus"},5:{t:"sus"},6:{t:"gm"},7:{t:"p2",n:2},8:{t:"p3",n:3}};
const SL={circle:{s:"\u25CF",c:"#E74C3C",b:"#FFF5F5"},square:{s:"\u25A0",c:"#3498DB",b:"#F0F7FF"},triangle:{s:"\u25B2",c:"#27AE60",b:"#F0FFF5"},cross:{s:"\u271A",c:"#F39C12",b:"#FFFAF0"},star:{s:"\u2605",c:"#9B59B6",b:"#F8F0FF"},whot:{s:"W",c:"#E94560",b:"#FFF0F3"}};
function mk(sh,v,id){const c={id,shape:sh,value:v,display:sh+" "+v};if(sh==="whot"){c.fx={t:"whot"};c.sc=50}else if(sh==="star"){c.fx=SFX[v];c.sc=20}else if(v===2){c.fx={t:"p2",n:2};c.sc=20}else if(v===5){c.fx={t:"p3",n:3};c.sc=20}else if(v===8){c.fx={t:"sus"};c.sc=20}else if(v===14){c.fx={t:"gm"};c.sc=20}else{c.fx=null;c.sc=v}return c}
function bDeck(){const d=[];let id=0;for(const s of SHAPES)for(let v=1;v<=14;v++)d.push(mk(s,v,id++));for(let v=1;v<=8;v++)d.push(mk("star",v,id++));for(let i=0;i<4;i++)d.push(mk("whot",20,id++));return d}
function mulberry32(seed){return()=>{let t=seed+=0x6D2B79F5;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296}}
function shufSeeded(a,rng){const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[b[i],b[j]]=[b[j],b[i]]}return b}

class Eng{
  constructor(ps,seed=0){this.ps=ps;this.np=ps.length;this.rng=mulberry32((seed||1)*2654435761);this.h={};this.mkt=[];this.pile=[];this.ci=0;this.dsh=null;this.pe=null;this.st="w";this.win=null;this.scores={};this.tc=0;this.winCond=null;this.log=[]}
  start(){const rng=this.rng;let d=shufSeeded(bDeck(),rng);for(const p of this.ps)this.h[p]=d.splice(0,5);this.mkt=d;let s=null,a=0;while(!s&&a<50){const c=this.mkt.shift();if(c.shape!=="whot"&&!(c.fx&&["p2","p3","sus","gm"].includes(c.fx.t)))s=c;else{this.mkt.push(c);this.mkt=shufSeeded(this.mkt,rng)}a++}this.pile=[s];this.st="p";this.log.push({t:0,top:s.display});return s}
  cur(){return this.ps[this.ci]}top(){return this.pile[this.pile.length-1]}next(k){this.ci=(this.ci+(k||1))%this.np}nextP(){return this.ps[(this.ci+1)%this.np]}
  cp(c){const t=this.top();if(c.shape==="whot")return true;if(this.dsh)return c.shape===this.dsh;if(this.pe){if(this.pe.t==="p2"&&c.value===2&&c.shape!=="star"&&c.shape!=="whot")return true;if(this.pe.t==="p3"&&c.value===5&&c.shape!=="star"&&c.shape!=="whot")return true;return false}return c.shape===t.shape||c.value===t.value}
  vp(p){return(this.h[p]||[]).filter(c=>this.cp(c))}hs(p){return(this.h[p]||[]).reduce((s,c)=>s+c.value,0)}
  dr(n){const r=[];for(let i=0;i<n;i++){if(!this.mkt.length)break;r.push(this.mkt.shift())}return r}
  chkMkt(){if(this.mkt.length>0)return null;this.st="f";this.winCond="market";for(const p of this.ps)this.scores[p]=this.hs(p);let b=null,bs=Infinity;for(const p of this.ps)if(this.scores[p]<bs){bs=this.scores[p];b=p}this.win=b;return{ev:"mkt_end",scores:this.scores,winner:b}}
  ex(p,a){
    if(this.st!=="p"||p!==this.cur()||this.tc>300)return null;this.tc++;this.log.push({t:this.tc,p,a:a.type});
    if(this.pe&&a.type!=="play"){const n=this.pe.n||0;const d=this.dr(n);this.h[p].push(...d);this.pe=null;const me=this.chkMkt();if(me)return me;this.next();return{ev:"pen",n:d.length}}
    if(this.pe&&a.type==="play"){const i=this.h[p].findIndex(c=>c.id===a.cid);if(i<0)return null;const c=this.h[p][i];if(!this.cp(c))return null;this.h[p].splice(i,1);this.pile.push(c);this.dsh=null;const nn=(this.pe.n||0)+(c.fx?.n||(c.value===2?2:3));if(!this.h[p].length){this.st="f";this.win=p;this.winCond="empty";for(const q of this.ps)this.scores[q]=this.hs(q);return{ev:"win",c}}this.pe={t:this.pe.t,n:nn};this.next();return{ev:"stk",c,n:nn}}
    if(a.type==="play"){const i=this.h[p].findIndex(c=>c.id===a.cid);if(i<0)return null;const c=this.h[p][i];if(!this.cp(c))return null;this.h[p].splice(i,1);this.pile.push(c);this.dsh=null;if(!this.h[p].length){this.st="f";this.win=p;this.winCond="empty";const np=this.nextP();if(c.fx&&(c.fx.t==="p2"||c.fx.t==="p3"))this.h[np].push(...this.dr(c.fx.n));for(const q of this.ps)this.scores[q]=this.hs(q);return{ev:"win",c}}if(c.fx){switch(c.fx.t){case"p2":this.pe={t:"p2",n:2};this.next();return{ev:"pk",c};case"p3":this.pe={t:"p3",n:3};this.next();return{ev:"pk",c};case"sus":this.next(2);return{ev:"sus",c};case"gm":for(let j=1;j<this.np;j++){const tp=this.ps[(this.ci+j)%this.np];this.h[tp].push(...this.dr(1))}const me=this.chkMkt();if(me)return me;this.next();return{ev:"gm",c};case"draw":{this.h[this.nextP()].push(...this.dr(c.fx.n));const me2=this.chkMkt();if(me2)return me2;this.next();return{ev:"sd",c}}case"whot":this.dsh=a.dsh||"circle";this.next();return{ev:"wh",c,dsh:a.dsh}}}this.next();return{ev:"pl",c}}
    if(a.type==="draw"){if(!this.mkt.length){const me=this.chkMkt();if(me)return me;this.next();return{ev:"emp"}}const d=this.dr(1);this.h[p].push(...d);const me=this.chkMkt();if(me)return me;if(this.cp(d[0]))return{ev:"drp",c:d[0]};this.next();return{ev:"dr"}}return null
  }
}
function doAI(e,p){const h=e.h[p]||[],v=e.vp(p),rnd=e.rng?e.rng:Math.random,sty=rnd()>.5?"aggressive":"strategic";let to=0;for(const q of e.ps)if(q!==p)to+=(e.h[q]||[]).length;const ao=to/(e.np-1);if(e.pe){if(v.length)return{type:"play",cid:v[0].id};return{type:"pen"}}if(!v.length)return{type:"draw"};const sc=v.map(c=>{let s=0;const sh={};for(const x of h)if(x.shape!=="whot"&&x.shape!=="star")sh[x.shape]=(sh[x.shape]||0)+1;if(c.shape!=="whot"&&c.shape!=="star")s+=(sh[c.shape]||0)*2;if(c.fx){switch(c.fx.t){case"p2":case"p3":if(ao<=2)s+=50;else if(ao<=4)s+=25;else if(sty==="aggressive")s+=15;else s-=10;break;case"sus":s+=ao<=2?40:8;break;case"gm":s+=ao<=3?20:5;break;case"draw":s+=c.fx.n*5;break;case"whot":s+=h.length<=3?35:5;break}}if(h.length<=3)s+=10;if(e.mkt.length<10)s+=15;s+=c.value*.3;return{c,s}});sc.sort((a,b)=>b.s-a.s||a.c.id-b.c.id);const best=sc[0].c,act={type:"play",cid:best.id};if(best.shape==="whot"){const rem=h.filter(x=>x.id!==best.id),sh={};for(const x of rem)if(x.shape!=="whot"&&x.shape!=="star")sh[x.shape]=(sh[x.shape]||0)+1;let bs="circle",bc=-1;for(const s of SHAPES)if((sh[s]||0)>bc){bc=sh[s]||0;bs=s}act.dsh=bs}return act}
function getReason(e,p,a,res){const h=e.h[p]||[];if(a.type==="pen")return"Accepts "+((res&&res.ev==="pen"&&res.n!=null)?res.n:(e.pe?.n||0))+"-card penalty";if(a.type==="draw")return"Draws from market";const c=h.find(x=>x.id===a.cid);if(!c)return"Plays";if(c.shape==="whot")return"WHOT > "+(a.dsh||"?").toUpperCase();if(c.fx?.t==="p2"||c.fx?.t==="p3")return c.display;if(c.fx?.t==="sus")return"Suspension!";return c.display}

// ═══ UI ATOMS ═══
const ACOL=["#3498DB","#E74C3C","#27AE60","#F39C12"];
function Card({card,small,big}){if(!card)return null;const l=SL[card.shape]||SL.whot;const w=big?80:small?28:56,h=big?112:small?40:80,fs=big?36:small?12:20,vs=big?14:small?7:11;return(<div style={{width:w,height:h,borderRadius:8,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",flexShrink:0,background:l.b,border:"2px solid "+l.c,boxShadow:"0 4px 16px "+l.c+"44"}}><span style={{color:l.c,fontSize:fs,lineHeight:1}}>{l.s}</span><span style={{color:l.c,fontSize:vs,fontWeight:700,marginTop:2,fontFamily:"monospace"}}>{card.value}</span></div>)}
function CardBack({count}){return(<div style={{display:"flex"}}>{Array.from({length:Math.min(count,7)}).map((_,i)=>(<div key={i} style={{width:28,height:40,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#1a1a36,#12122a)",border:"1.5px solid #E9456033",marginLeft:i>0?-10:0,boxShadow:"0 2px 6px #00000044"}}><span style={{color:"#E94560",fontSize:8,opacity:.4}}>?</span></div>))}{count>7&&<span style={{fontSize:11,marginLeft:4,alignSelf:"center",color:"#444"}}>+{count-7}</span>}</div>)}
function FloatingCards(){const cards=[{shape:"circle",value:14},{shape:"whot",value:20},{shape:"star",value:7},{shape:"triangle",value:2},{shape:"square",value:8},{shape:"cross",value:5}];return(<div style={{position:"absolute",inset:0,overflow:"hidden",pointerEvents:"none",opacity:.08}}>{cards.map((c,i)=>{const l=SL[c.shape];return(<div key={i} style={{position:"absolute",left:(5+(i*16)%85)+"%",top:(10+((i*37)%60))+"%",animation:"wf "+(6+(i%3)*2)+"s ease-in-out "+i*.5+"s infinite alternate"}}><div style={{width:56,height:80,borderRadius:12,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:l.b,border:"2px solid "+l.c}}><span style={{fontSize:22,color:l.c}}>{l.s}</span><span style={{fontSize:11,fontWeight:800,color:l.c,fontFamily:"monospace"}}>{c.value}</span></div></div>)})}<style>{"@keyframes wf{0%{transform:translateY(0)}100%{transform:translateY(-25px)}}"}</style></div>)}
function Spin(){return<div style={{width:14,height:14,border:"2px solid #E9456044",borderTop:"2px solid #E94560",borderRadius:"50%",animation:"sp .6s linear infinite",display:"inline-block"}}><style>{"@keyframes sp{to{transform:rotate(360deg)}}"}</style></div>}

// ═══ MODALS ═══
function RulesModal({onAccept,onClose}){const[ok,setOk]=useState(false);const rules=["54-card deck: Circle, Square, Triangle, Cross (1-14), Star (1-8), 4 WHOT wildcards.","Match top card by shape OR value. WHOT = wildcard, declare any shape.","Pick 2 (value 2) / Pick 3 (value 5) force next player draws. Stackable.","Suspension (value 8): Next player loses turn.","General Market (value 14): All other players draw 1.","Star effects: Star 7=Pick 2, Star 8=Pick 3, Star 4-5=Suspension.","First empty hand wins. If market empties, lowest hand score wins.","2-4 players. Wagers in $WHOT tokens escrowed on-chain, winner claims 95% of pot."];return(<div style={{position:"fixed",inset:0,zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",padding:16,background:"rgba(0,0,0,.75)",backdropFilter:"blur(4px)"}}><div style={{width:"100%",maxWidth:480,borderRadius:16,padding:24,background:"#0d0d1e",border:"1px solid #E9456044"}}><h2 style={{color:"#E94560",fontFamily:"'Courier New',monospace",fontSize:18,fontWeight:700,marginBottom:16}}>WHOT Rules</h2><div style={{maxHeight:300,overflowY:"auto"}}>{rules.map((r,i)=>(<div key={i} style={{display:"flex",gap:8,fontSize:12,lineHeight:1.6,color:"#aaa",marginBottom:8}}><span style={{color:"#E94560",flexShrink:0}}>{"\u2022"}</span><span>{r}</span></div>))}</div><label style={{display:"flex",alignItems:"center",gap:8,margin:"20px 0",cursor:"pointer"}}><input type="checkbox" checked={ok} onChange={e=>setOk(e.target.checked)} style={{accentColor:"#E94560"}}/><span style={{fontSize:12,color:"#888"}}>I accept the WHOT rules.</span></label><div style={{display:"flex",gap:12}}><button onClick={onClose} style={{padding:"8px 20px",borderRadius:8,fontSize:13,border:"1px solid #333",color:"#888",background:"none",cursor:"pointer"}}>Close</button><button onClick={()=>ok&&onAccept()} disabled={!ok} style={{padding:"8px 20px",borderRadius:8,fontSize:13,fontWeight:700,background:ok?"#E94560":"#333",color:ok?"#fff":"#666",border:"none",cursor:ok?"pointer":"not-allowed"}}>Accept</button></div></div></div>)}
function AgentModal({onDone,onClose,initialName,wallet}){const[n,setN]=useState(initialName||"");return(<div style={{position:"fixed",inset:0,zIndex:50,display:"flex",alignItems:"center",justifyContent:"center",padding:16,background:"rgba(0,0,0,.75)",backdropFilter:"blur(4px)"}}><div style={{width:"100%",maxWidth:420,borderRadius:16,padding:24,background:"#0d0d1e",border:"1px solid #E9456044"}}><h2 style={{color:"#E94560",fontFamily:"'Courier New',monospace",fontSize:18,fontWeight:700,marginBottom:8}}>Setup Your Agent</h2><p style={{fontSize:12,color:"#555",marginBottom:20}}>Set a username for your WHOT agent. This name is stored on your device and shared with opponents in the same browser.</p><label style={{fontSize:12,color:"#aaa",display:"block",marginBottom:6}}>Agent Username</label><input value={n} onChange={e=>setN(e.target.value)} placeholder="e.g. NaijaKing" maxLength={20} style={{width:"100%",padding:"10px 14px",borderRadius:8,fontSize:14,background:"#0a0a16",border:"1px solid #1a1a30",color:"#e0e0e8",fontFamily:"monospace",outline:"none",boxSizing:"border-box",marginBottom:20}}/><div style={{display:"flex",gap:12}}><button onClick={onClose} style={{padding:"8px 20px",borderRadius:8,fontSize:13,border:"1px solid #333",color:"#888",background:"none",cursor:"pointer"}}>Cancel</button><button onClick={()=>{if(n.trim()){const name=n.trim();saveAgentName(name,wallet?.address);onDone({name})}}} disabled={!n.trim()} style={{padding:"8px 20px",borderRadius:8,fontSize:13,fontWeight:700,background:n.trim()?"#E94560":"#333",color:n.trim()?"#fff":"#666",border:"none",cursor:n.trim()?"pointer":"not-allowed"}}>Save</button></div></div></div>)}

// ═══ CREATE LOBBY (on-chain tx) ═══
function CreateLobby({onBack,onCreated,wallet,sContract,signer}){
  const[bet,setBet]=useState("100");const[pc,setPc]=useState(2);const[busy,setBusy]=useState(false);const[err,setErr]=useState("");const[step,setStep]=useState("");
  const[bal,setBal]=useState(null);
  useEffect(()=>{if(!wallet)return;const tc=readTokenCon();if(!tc)return;tc.balanceOf(wallet.address).then(b=>setBal(E().formatEther(b))).catch(()=>{})},[wallet]);
  const go=async()=>{if(!sContract||!signer)return;setBusy(true);setErr("");setStep("");try{
    const amt=E().parseEther(bet);
    const tc=tokenCon(signer);
    // Check allowance first
    setStep("Checking allowance...");
    const allow=await tc.allowance(wallet.address,V2);
    if(allow<amt){
      setStep("Approving $WHOT spend...");
      const atx=await tc.approve(V2,amt);
      await atx.wait();
    }
    setStep("Creating match...");
    const tx=await sContract.createMatch(pc,amt);await tx.wait();
    const mc=await sContract.matchCount();onCreated(Number(mc),pc,bet)
  }catch(e){
    const msg=e.reason||e.message||"Tx failed";
    const isFetch=(msg.includes("Failed to fetch")||msg.includes("-32683"));
    setErr(isFetch?"Network error: RPC unreachable. Try again.":msg);
  }finally{setBusy(false);setStep("")}};
  return(<div style={{minHeight:"100vh",display:"flex",flexDirection:"column",background:"#06060e",fontFamily:"monospace"}}><nav style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 24px",borderBottom:"1px solid #1a1a30"}}><span style={{display:"flex",alignItems:"center",gap:8}}><span style={{color:"#E94560",fontWeight:900}}>WHOT</span><span style={{color:"#444"}}>Arena</span></span><span style={{fontSize:11,padding:"4px 12px",borderRadius:6,color:"#27AE60",background:"#27AE6015",border:"1px solid #27AE6033"}}>{sa(wallet.address)}</span></nav><div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:16}}><button onClick={onBack} style={{alignSelf:"flex-start",marginBottom:24,padding:"8px 16px",borderRadius:8,fontSize:13,border:"1px solid #1a1a30",color:"#888",background:"none",cursor:"pointer"}}>{"\u2190"} Back</button><h1 style={{fontSize:22,fontWeight:700,color:"#e0e0e8",fontFamily:"'Courier New',monospace",marginBottom:8}}>Create lobby</h1><p style={{fontSize:13,color:"#555",marginBottom:32,textAlign:"center"}}>Wager $WHOT tokens. You'll approve the spend then create the match.</p><div style={{width:"100%",maxWidth:420,borderRadius:16,padding:32,background:"#0d0d1e",border:"1px solid #1a1a30"}}>
    <label style={{fontSize:13,color:"#aaa",display:"block",marginBottom:8}}>Players</label>
    <div style={{display:"flex",gap:8,marginBottom:20}}>{[2,3,4].map(n=>(<button key={n} onClick={()=>setPc(n)} style={{flex:1,padding:"10px 0",borderRadius:8,fontSize:14,fontWeight:700,background:pc===n?"#E9456022":"#0a0a16",color:pc===n?"#E94560":"#555",border:"1px solid "+(pc===n?"#E9456044":"#1a1a30"),cursor:"pointer"}}>{n}P</button>))}</div>
    <label style={{fontSize:13,color:"#aaa",display:"block",marginBottom:8}}>Wager ($WHOT)</label><input type="text" value={bet} onChange={e=>setBet(e.target.value)} style={{width:"100%",padding:"10px 14px",borderRadius:8,fontSize:14,background:"#0a0a16",border:"1px solid #1a1a30",color:"#e0e0e8",fontFamily:"monospace",outline:"none",boxSizing:"border-box",marginBottom:8}}/><p style={{fontSize:11,color:"#444",marginBottom:4}}>Pot = {bet} x {pc} = {(parseFloat(bet||0)*pc).toFixed(0)} $WHOT</p>{bal!==null&&<p style={{fontSize:11,color:"#27AE60",marginBottom:20}}>Your balance: {parseFloat(bal).toLocaleString()} $WHOT</p>}
    {err&&<p style={{fontSize:11,color:"#E74C3C",marginBottom:12}}>{err}</p>}
    {step&&<p style={{fontSize:11,color:"#E94560",marginBottom:12}}>{step}</p>}
    <button onClick={go} disabled={busy} style={{width:"100%",padding:"12px 0",borderRadius:12,fontSize:14,fontWeight:700,background:busy?"#333":"#E94560",color:busy?"#666":"#fff",border:"none",cursor:busy?"wait":"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>{busy&&<Spin/>}{busy?(step||"Processing..."):"Create lobby (on-chain)"}</button>
  </div></div></div>)
}

// ═══ GAME VIEW (plays + settles on-chain) ═══
function GameView({onBack,wagerAmt,agents,matchId,sContract,wallet,rc}){
  const[events,setEvents]=useState([]);const[running,setRunning]=useState(false);
  const[display,setDisplay]=useState({pCards:{},topCard:null,declared:null,mktCount:0});
  const SPEED=600;const[endScores,setEndScores]=useState(null);
  const[settling,setSettling]=useState(false);const[settled,setSettled]=useState(false);const[stx,setStx]=useState("");
  const[showYouLost,setShowYouLost]=useState(false);const[showYouWon,setShowYouWon]=useState(false);
  const[liveAgents,setLiveAgents]=useState(agents);
  const engRef=useRef(null);const intRef=useRef(null);const evRef=useRef(null);const startedRef=useRef(false);
  // Engine uses lowercased addresses as player IDs (deterministic across browsers)
  const pids=liveAgents.map(a=>a.address.toLowerCase());
  const pidsRef=useRef(pids);pidsRef.current=pids;
  // Display names for UI only
  const nameMap={};liveAgents.forEach(a=>{nameMap[a.address.toLowerCase()]=a.name||sa(a.address)});
  const dn=(pid)=>nameMap[pid]||sa(pid); // display name lookup
  const names=pids.map(p=>dn(p)); // for UI display
  const namesRef=useRef(names);namesRef.current=names;

  const scrollTs=useRef(0);useEffect(()=>{const el=evRef.current;if(!el)return;const now=Date.now();if(now-scrollTs.current>150){scrollTs.current=now;el.scrollTo({top:el.scrollHeight,behavior:"smooth"})}else{el.scrollTop=el.scrollHeight}},[events]);
  useEffect(()=>()=>{if(intRef.current)clearInterval(intRef.current)},[]);
  
  // Sync liveAgents when agents prop changes - never overwrite with fewer players (poll may have more)
  useEffect(()=>{
    const diff=agents.length!==liveAgents.length||agents.some((a,i)=>a.address!==liveAgents[i]?.address);
    const agentsNotStale=agents.length>=liveAgents.length;
    if(diff&&agentsNotStale)setLiveAgents(agents);
  },[agents,liveAgents.length]);
  
  // Poll + event subscription to detect when players join - event gives instant update, poll is fallback
  useEffect(()=>{
    if(!rc||!matchId||running)return;
    let cancelled=false;
    const applyPlayers=(players)=>{
      if(cancelled)return;
      setLiveAgents(prev=>{
        if(players.length===prev.length&&players.every((p,i)=>p.toLowerCase()===prev[i]?.address?.toLowerCase()))return prev;
        const myName=prev.find(a=>a.address===wallet?.address)?.name||agents.find(a=>a.address===wallet?.address)?.name||getAgentName()||"";
        return players.map(a=>{
          const isYou=wallet&&a.toLowerCase()===wallet.address.toLowerCase();
          const existing=prev.find(ag=>ag.address.toLowerCase()===a.toLowerCase());
          const oppName=getAgentNameByAddress(a);
          return{name:isYou?myName:(oppName||existing?.name||sa(a)),address:a};
        });
      });
    };
    const check=async()=>{
      if(cancelled)return;
      try{const m=await rc.getMatch(matchId);applyPlayers(m.players||[])}catch(e){if(!cancelled)console.error("Poll error:",e)}
    };
    check();
    const iv=setInterval(check,1000);
    const filter=rc.filters.PlayerJoined(matchId);
    const onJoined=()=>{if(!cancelled)check()};
    rc.on(filter,onJoined);
    return()=>{cancelled=true;clearInterval(iv);rc.off(filter,onJoined)};
  },[rc,matchId,running,agents,wallet]);
  
  const upd=(e)=>{const o={};for(const p of pidsRef.current)o[dn(p)]=(e.h[p]||[]).length;setDisplay(d=>({...d,pCards:o,mktCount:e.mkt.length,topCard:e.top(),declared:e.dsh}));};

  const onLoss=useCallback(()=>{setShowYouLost(true);setTimeout(()=>onBack(),3000)},[onBack]);
  const onWin=useCallback(()=>{setShowYouWon(true);setTimeout(()=>onBack(),3000)},[onBack]);
  const settle=useCallback(async(eng)=>{
    if(!sContract||!matchId||settled||settling)return;setSettling(true);
    try{
      const winAddr=eng.win; // engine winner is already a lowercased address
      const scores=(pidsRef.current||[]).map(p=>eng.scores[p]||0);
      const hash=E().keccak256(E().toUtf8Bytes(JSON.stringify(eng.log)));
      const tx=await sContract.resolveMatch(matchId,winAddr,eng.winCond==="market"?1:0,scores,hash);
      await tx.wait();setStx(tx.hash);setSettled(true);
      setEvents(p=>[...p,{t:eng.tc+1,desc:"Settled on-chain! tx: "+tx.hash.slice(0,20)+"...",type:"info"}]);
      markMatchClosed(matchId,"completed");
    }catch(e){setEvents(p=>[...p,{t:0,desc:"Settle err: "+(e.reason||e.message),type:"pick"}])}finally{setSettling(false)}
  },[sContract,matchId,settled,settling,liveAgents,wallet]);

  const startMatch=useCallback(()=>{
    if(liveAgents.length<2||startedRef.current)return;
    startedRef.current=true;if(intRef.current)clearInterval(intRef.current);setEndScores(null);setSettled(false);setStx("");
    const curPids=pidsRef.current;
    const eng=new Eng(curPids,matchId||1);const sc=eng.start();engRef.current=eng;
    const ic={};for(const p of curPids)ic[dn(p)]=5;
    setDisplay({pCards:ic,topCard:sc,declared:null,mktCount:eng.mkt.length});
    setEvents([{t:0,desc:"Game started ("+curPids.length+"P). Market: "+eng.mkt.length+". Top: "+sc.display,type:"info"}]);setRunning(true);
    intRef.current=setInterval(()=>{
      const e=engRef.current;
      if(!e){clearInterval(intRef.current);setRunning(false);return}
      const dnNow=(pid)=>{const nm={};liveAgents.forEach(a=>{nm[a.address.toLowerCase()]=a.name||sa(a.address)});return nm[pid]||sa(pid)};
      if(e.tc>300){clearInterval(intRef.current);setRunning(false);e.st="f";e.winCond="market";for(const p of e.ps)e.scores[p]=e.hs(p);let b=null,bs=Infinity;for(const p of e.ps)if(e.scores[p]<bs){bs=e.scores[p];b=p}e.win=b;setEndScores(e.scores);upd(e);setEvents(p=>{const next=[...p,{t:e.tc,desc:"Turn limit! "+dnNow(e.win)+" WINS (lowest hand)",type:"win"}];return next.length>80?next.slice(-80):next});const iWon=wallet&&e.win===wallet.address.toLowerCase();if(iWon)onWin();else if(wallet)onLoss();settle(e);return}
      if(e.st!=="p"){clearInterval(intRef.current);setRunning(false);return}
      const pid=e.cur(),act=doAI(e,pid);let res=e.ex(pid,act);let rsn=getReason(e,pid,act,res);
      if(!res){const fallback=e.pe?{type:"pen"}:{type:"draw"};res=e.ex(pid,fallback);rsn=getReason(e,pid,fallback,res)}
      if(!res){e.next();return}
      if(res.ev==="mkt_end"){clearInterval(intRef.current);setRunning(false);setEndScores(res.scores);upd(e);const so=Object.entries(res.scores).sort((a,b)=>a[1]-b[1]);setEvents(p=>{const next=[...p,{t:e.tc,desc:"MARKET EMPTY! "+so.map(([n,s])=>dnNow(n).slice(0,8)+":"+s).join(", ")+" | "+dnNow(res.winner)+" WINS!",type:"win"}];return next.length>80?next.slice(-80):next});const iWon=wallet&&res.winner===wallet.address.toLowerCase();if(iWon)onWin();else if(wallet)onLoss();settle(e);return}
      const et=res.ev==="win"?"win":res.ev==="pk"||res.ev==="pen"||res.ev==="stk"?"pick":res.ev==="wh"?"whot":res.ev==="sus"?"sus":"normal";
      setEvents(p=>{const next=[...p,{t:e.tc,player:dnNow(pid),desc:rsn,type:et,card:res.c}];return next.length>80?next.slice(-80):next});upd(e);
      if(res.ev==="win"){clearInterval(intRef.current);setRunning(false);setEndScores(e.scores);setEvents(p=>{const next=[...p,{t:e.tc,desc:"!! "+dnNow(e.win)+" WINS! (empty hand)",type:"win"}];return next.length>80?next.slice(-80):next});const iWon=wallet&&e.win===wallet.address.toLowerCase();if(iWon)onWin();else if(wallet)onLoss();settle(e);return}
      if(res.ev==="drp"&&res.c){const fa={type:"play",cid:res.c.id};if(res.c.shape==="whot"){const hh=e.h[pid]||[],sc2={};for(const x of hh)if(x.shape!=="whot"&&x.shape!=="star")sc2[x.shape]=(sc2[x.shape]||0)+1;let bs="circle",bc=-1;for(const ss of SHAPES)if((sc2[ss]||0)>bc){bc=sc2[ss]||0;bs=ss}fa.dsh=bs}const fr=e.ex(pid,fa);if(fr){if(fr.ev==="mkt_end"){clearInterval(intRef.current);setRunning(false);setEndScores(fr.scores);upd(e);setEvents(p=>{const next=[...p,{t:e.tc,desc:"MARKET EMPTY! "+dnNow(fr.winner)+" WINS!",type:"win"}];return next.length>80?next.slice(-80):next});const iWon=wallet&&fr.winner===wallet.address.toLowerCase();if(iWon)onWin();else if(wallet)onLoss();settle(e);return}setEvents(p=>{const next=[...p,{t:e.tc,player:dnNow(pid),desc:"Plays drawn card",type:fr.ev==="win"?"win":"normal",card:fr.c}];return next.length>80?next.slice(-80):next});upd(e);if(fr.ev==="win"){clearInterval(intRef.current);setRunning(false);setEndScores(e.scores);setEvents(p=>{const next=[...p,{t:e.tc,desc:"!! "+dnNow(e.win)+" WINS!",type:"win"}];return next.length>80?next.slice(-80):next});const iWon=wallet&&e.win===wallet.address.toLowerCase();if(iWon)onWin();else if(wallet)onLoss();settle(e)}}else{e.next()}}
    },SPEED)
  },[settle,liveAgents.length,liveAgents,wallet,onLoss,onWin]);

  useEffect(()=>{startedRef.current=false},[matchId]);
  useEffect(()=>{if(liveAgents.length>=2)startMatch()},[liveAgents.length,startMatch]);
  const isA=p=>{const e=engRef.current;if(!e||!running)return false;const curAddr=e.cur();return dn(curAddr)===p};const mp=display.mktCount/54*100;

  const handleForfeit=async()=>{
    if(intRef.current)clearInterval(intRef.current);
    setRunning(false);
    const other=liveAgents.find(a=>a.address.toLowerCase()!==wallet?.address?.toLowerCase());
    if(!other){setEvents(p=>[...p,{t:0,desc:"Cannot forfeit: no opponent.",type:"pick"}]);return}
    setEvents(p=>[...p,{t:(engRef.current?.tc||0)+1,desc:"You forfeited. "+other.name+" wins.",type:"win"}]);
    const winnerName=other.name||sa(other.address);
    const forfeitEng={win:winnerName,winCond:"empty",scores:Object.fromEntries(names.map(n=>[n,n===winnerName?0:999])),log:[{t:0,forfeit:true,winner:winnerName}],tc:(engRef.current?.tc||0)+1};
    await settle(forfeitEng);
    markMatchClosed(matchId,"forfeit");
    onLoss();
  };

  if(isMatchClosed(matchId)){
    return(<div style={{height:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#06060e",fontFamily:"monospace",color:"#e0e0e8"}}>
      <div style={{padding:32,borderRadius:16,background:"#0d0d1e",border:"1px solid #E9456044",textAlign:"center"}}>
        <div style={{fontSize:18,fontWeight:700,color:"#E94560",marginBottom:8}}>Match closed</div>
        <div style={{fontSize:13,color:"#aaa",marginBottom:20}}>This match has already ended.</div>
        <button onClick={onBack} style={{padding:"8px 20px",borderRadius:8,fontSize:13,fontWeight:700,background:"#E94560",color:"#fff",border:"none",cursor:"pointer"}}>Back to menu</button>
      </div>
    </div>);
  }

  if(liveAgents.length<2){
    return(<div style={{height:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#06060e",fontFamily:"monospace",color:"#e0e0e8"}}>
      <div style={{padding:32,borderRadius:16,background:"#0d0d1e",border:"1px solid #1a1a30",textAlign:"center"}}>
        <div style={{fontSize:18,fontWeight:700,marginBottom:8}}>Waiting for opponent</div>
        <div style={{fontSize:13,color:"#888",marginBottom:20}}>Match {matchId?("#"+matchId):""} · {liveAgents.length}/2 players joined</div>
        <p style={{fontSize:11,color:"#555",marginBottom:16,maxWidth:280}}>Use a different MetaMask account in the other browser to join. Same account cannot join twice.</p>
        <button onClick={onBack} style={{padding:"8px 20px",borderRadius:8,fontSize:13,border:"1px solid #333",color:"#888",background:"none",cursor:"pointer"}}>Back to lobbies</button>
      </div>
    </div>);
  }

  return(<div style={{height:"100vh",display:"flex",flexDirection:"column",background:"#06060e",fontFamily:"monospace",color:"#e0e0e8",overflow:"hidden",position:"relative"}}>
    <nav style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 20px",borderBottom:"1px solid #1a1a30",flexShrink:0}}>
      <button onClick={()=>{if(intRef.current)clearInterval(intRef.current);onBack()}} style={{fontSize:13,color:"#888",background:"none",border:"none",cursor:"pointer"}}>{"\u2190"} Back</button>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        {matchId&&<span style={{fontSize:10,color:"#555"}}>Match #{matchId}</span>}
        {settled&&<span style={{fontSize:10,color:"#27AE60"}}>{"\u2713"} On-chain</span>}
        {settling&&<><Spin/><span style={{fontSize:10,color:"#F39C12"}}>Settling...</span></>}
        <button onClick={handleForfeit} style={{padding:"6px 12px",borderRadius:8,fontSize:11,fontWeight:700,background:"#E74C3C",color:"#fff",border:"none",cursor:"pointer"}}>Forfeit</button>
      </div>
    </nav>
    <div style={{display:"flex",flexWrap:"wrap",padding:"8px 20px 0",gap:8,flexShrink:0}}>
      {liveAgents.map((ag,i)=>{const col=ACOL[i%4],n=ag.name||sa(ag.address),act=isA(n);return(<div key={i} style={{flex:1,minWidth:120,padding:"6px 12px",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"space-between",background:act?col+"11":"#0a0a16",border:"1px solid "+(act?col+"44":"#1a1a30")}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:6,height:6,borderRadius:3,background:act?col:"#333"}}/><span style={{fontSize:11,fontWeight:700,color:col}}>{n}</span></div><span style={{fontSize:10,color:col}}>{display.pCards[n]||0}</span></div>)})}
    </div>
    <div style={{flex:1,display:"flex",padding:"8px 20px",gap:12,minHeight:0}}>
      <div style={{flex:1,borderRadius:16,overflow:"hidden",position:"relative",background:"radial-gradient(ellipse at 50% 60%,#0d1520,#080810)",border:"1px solid #1a1a30"}}>
        <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",perspective:900}}>
          <div style={{transform:"rotateX(50deg)",transformStyle:"preserve-3d",width:380,height:380,background:"linear-gradient(160deg,#0e1825 0%,#0a1220 50%,#0e1825 100%)",borderRadius:20,border:"2px solid #1a2a3a",boxShadow:"0 50px 100px rgba(0,0,0,.7)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",position:"relative"}}>
            <div style={{position:"absolute",inset:0,borderRadius:18,overflow:"hidden",opacity:.1}}>{[1,2,3,4,5,6,7].map(i=>(<div key={"h"+i} style={{position:"absolute",left:0,right:0,top:i*12.5+"%",height:1,background:"#4488aa"}}/>))}{[1,2,3,4,5,6,7].map(i=>(<div key={"v"+i} style={{position:"absolute",top:0,bottom:0,left:i*12.5+"%",width:1,background:"#4488aa"}}/>))}</div>
            {liveAgents.length>=2&&<div style={{position:"absolute",top:12,transform:"translateZ(8px)"}}><CardBack count={display.pCards[names[1]]||0}/></div>}
            {liveAgents.length>=3&&<div style={{position:"absolute",left:-30,top:"50%",transform:"translateY(-50%) translateZ(8px) rotate(90deg)"}}><CardBack count={display.pCards[names[2]]||0}/></div>}
            {liveAgents.length>=4&&<div style={{position:"absolute",right:-30,top:"50%",transform:"translateY(-50%) translateZ(8px) rotate(-90deg)"}}><CardBack count={display.pCards[names[3]]||0}/></div>}
            <div style={{display:"flex",alignItems:"center",gap:16,transform:"translateZ(16px)"}}><div style={{width:56,height:80,borderRadius:8,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:"#080c14",border:"2px solid #1a2a3a"}}><span style={{color:"#E94560",fontSize:16,opacity:.4}}>?</span><span style={{fontSize:10,fontWeight:700,color:display.mktCount>15?"#27AE60":display.mktCount>5?"#F39C12":"#E74C3C",marginTop:2}}>{display.mktCount}</span></div>{display.topCard?<Card card={display.topCard} big/>:<div style={{width:80,height:112,borderRadius:8,border:"2px dashed #333"}}/>}</div>
            <div style={{position:"absolute",bottom:12,transform:"translateZ(8px)"}}><CardBack count={display.pCards[names[0]]||0}/></div>
            {display.declared&&<div style={{position:"absolute",right:liveAgents.length>=4?60:24,top:liveAgents.length>=4?"20%":"50%",transform:"translateY(-50%) translateZ(12px)"}}><div style={{padding:"6px 10px",borderRadius:8,textAlign:"center",background:(SL[display.declared]?.c||"#fff")+"22",border:"1px solid "+(SL[display.declared]?.c||"#fff")+"44"}}><span style={{fontSize:18,color:SL[display.declared]?.c}}>{SL[display.declared]?.s}</span><div style={{fontSize:10,fontWeight:700,color:SL[display.declared]?.c}}>MUST</div></div></div>}
            {wagerAmt>0&&<div style={{position:"absolute",left:liveAgents.length>=3?60:24,top:liveAgents.length>=3?"20%":"50%",transform:"translateY(-50%) translateZ(12px)"}}><div style={{padding:"6px 10px",borderRadius:8,textAlign:"center",background:"#F39C1215",border:"1px solid #F39C1233"}}><div style={{fontWeight:700,fontSize:14,color:"#F39C12"}}>{(wagerAmt*liveAgents.length).toFixed(3)}</div><div style={{fontSize:9,color:"#F39C1266"}}>{liveAgents.length}x{wagerAmt}</div></div></div>}
          </div>
        </div>
        <div style={{position:"absolute",bottom:8,left:0,right:0,textAlign:"center"}}><span style={{fontSize:11,color:"#333"}}>{running?"Spectating":settled?"Settled on Monad":"Match ended"}</span></div>
        <div style={{position:"absolute",top:10,left:10,right:10}}><div style={{height:3,borderRadius:2,background:"#1a1a30",overflow:"hidden"}}><div style={{height:"100%",borderRadius:2,background:display.mktCount>15?"#27AE60":display.mktCount>5?"#F39C12":"#E74C3C",width:mp+"%",transition:"width 0.3s"}}/></div><div style={{fontSize:9,color:"#555",marginTop:3}}>Market: {display.mktCount} cards</div></div>
        {endScores&&<div style={{position:"absolute",bottom:28,left:"50%",transform:"translateX(-50%)",padding:"8px 16px",borderRadius:10,background:"#0a0a16ee",border:"1px solid #27AE6044"}}><div style={{fontSize:10,color:"#888",marginBottom:4}}>Final Scores (lowest wins)</div>{Object.entries(endScores).sort((a,b)=>a[1]-b[1]).map(([addr,s],i)=>(<div key={addr} style={{fontSize:11,color:i===0?"#27AE60":"#888"}}>{i===0?"\uD83D\uDC51 ":""}{dn(addr)}: {s}</div>))}</div>}
      </div>
      <div style={{width:256,flexShrink:0,borderRadius:16,display:"flex",flexDirection:"column",background:"#0d0d1e",border:"1px solid #1a1a30"}}>
        <div style={{padding:"10px 12px",borderBottom:"1px solid #1a1a30",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"space-between"}}><span style={{fontSize:11,fontWeight:700,color:"#E94560"}}>AGENT LOG</span>{stx&&<a href={"https://monadscan.com/tx/"+stx} target="_blank" rel="noreferrer" style={{fontSize:9,color:"#27AE60"}}>view tx</a>}</div>
        <div ref={evRef} style={{flex:1,overflowY:"auto",minHeight:0}}>{events.map((ev,i)=>{const pi=ev.player?names.indexOf(ev.player):-1;const col=pi>=0?ACOL[pi%4]:"#555";return(<div key={i} style={{display:"flex",alignItems:"flex-start",gap:6,padding:"4px 10px",borderBottom:"1px solid #0a0a14",background:ev.type==="win"?"#27AE6011":ev.type==="pick"?"#E74C3C08":"transparent"}}><span style={{fontSize:9,width:16,textAlign:"right",flexShrink:0,color:"#333"}}>{ev.t}</span>{ev.player?<span style={{fontSize:9,flexShrink:0,fontWeight:700,color:col,width:28,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ev.player.slice(0,5)}</span>:<span style={{width:28,color:"#555",fontSize:9}}>*</span>}{ev.card&&<div style={{flexShrink:0}}><Card card={ev.card} small/></div>}<span style={{fontSize:10,lineHeight:1.3,color:ev.type==="win"?"#27AE60":ev.type==="pick"?"#E74C3C":ev.type==="whot"?"#E94560":ev.type==="info"?"#3498DB":"#777"}}>{ev.desc}</span></div>)})}</div>
      </div>
    </div>
    {showYouLost&&<div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.85)",backdropFilter:"blur(8px)"}}><div style={{padding:48,borderRadius:20,background:"#0d0d1e",border:"2px solid #E74C3C",textAlign:"center",animation:"pulse 0.5s ease"}}><div style={{fontSize:28,fontWeight:900,color:"#E74C3C",fontFamily:"'Courier New',monospace",marginBottom:8}}>You lost</div><div style={{fontSize:13,color:"#888"}}>Returning to menu...</div><style>{"@keyframes pulse{0%{transform:scale(0.95);opacity:0}100%{transform:scale(1);opacity:1}}"}</style></div></div>}
    {showYouWon&&<div style={{position:"fixed",inset:0,zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.85)",backdropFilter:"blur(8px)"}}><div style={{padding:48,borderRadius:20,background:"#0d0d1e",border:"2px solid #27AE60",textAlign:"center",animation:"pulse 0.5s ease"}}><div style={{fontSize:28,fontWeight:900,color:"#27AE60",fontFamily:"'Courier New',monospace",marginBottom:8}}>You won!</div><div style={{fontSize:13,color:"#888"}}>Prize claimed. Returning to menu...</div><style>{"@keyframes pulse{0%{transform:scale(0.95);opacity:0}100%{transform:scale(1);opacity:1}}"}</style></div></div>}
  </div>);
}

// ═══ ON-CHAIN LOBBIES ═══
function OpenLobbies({rc,sContract,wallet,onJoined,signer}){
  const[lobbies,setLobbies]=useState([]);const[loading,setLoading]=useState(true);const[joining,setJoining]=useState(null);
  const load=useCallback(async()=>{if(!rc)return;setLoading(true);try{const ids=await rc.getOpenMatches();const rows=[];for(const id of ids){try{const m=await rc.getMatch(id);const row={id:Number(m.id),max:Number(m.maxPlayers),cur:Number(m.currentPlayers),wager:m.wagerPerPlayer,players:m.players,at:Number(m.createdAt)};if(isMatchClosed(row.id))continue;rows.push(row)}catch{}}rows.sort((a,b)=>b.at-a.at);setLobbies(rows)}catch{}finally{setLoading(false)}},[rc]);
  useEffect(()=>{load();const iv=setInterval(load,8000);return()=>clearInterval(iv)},[load]);
  const join=async(l)=>{
    if(!sContract||!wallet||!rc)return;
    const alreadyJoined=l.players.some(p=>p.toLowerCase()===wallet.address.toLowerCase());
    if(alreadyJoined){
      // Refresh lobby data before re-entering
      try{
        const m=await rc.getMatch(l.id);
        const updated={id:Number(m.id),max:Number(m.maxPlayers),cur:Number(m.currentPlayers),wager:m.wagerPerPlayer,players:m.players||[],at:Number(m.createdAt)};
        onJoined(updated);
      }catch{
        onJoined(l);
      }
      return;
    }
    if(l.cur>=l.max){
      alert("Lobby is full.");
      return;
    }
    setJoining(l.id);
    try{
      // Approve $WHOT spend if needed
      if(signer){
        const tc=tokenCon(signer);
        const allow=await tc.allowance(wallet.address,V2);
        if(allow<l.wager){const atx=await tc.approve(V2,l.wager);await atx.wait()}
      }
      const tx=await sContract.joinMatch(l.id);
      await tx.wait();
      // Wait a moment for contract state to update, then refresh
      await new Promise(r=>setTimeout(r,1000));
      const m=await rc.getMatch(l.id);
      const updated={id:Number(m.id),max:Number(m.maxPlayers),cur:Number(m.currentPlayers),wager:m.wagerPerPlayer,players:m.players||[],at:Number(m.createdAt)};
      onJoined(updated);
    }catch(e){
      alert(e.reason||e.message);
    }finally{
      setJoining(null);
    }
  };
  if(loading)return<div style={{padding:32,textAlign:"center"}}><Spin/><p style={{fontSize:11,color:"#555",marginTop:12}}>Fetching on-chain lobbies...</p></div>;
  const visible=lobbies.filter(l=>{
    if(isMatchClosed(l.id))return false;
    if(!wallet)return l.cur<l.max;
    const youIn=l.players.some(p=>p.toLowerCase()===wallet.address.toLowerCase());
    return youIn||l.cur<l.max;
  });
  if(!visible.length)return null;
  return(<div style={{marginBottom:16}}>{visible.map(l=>{const youIn=wallet&&l.players.some(p=>p.toLowerCase()===wallet.address.toLowerCase());return(<div key={l.id} style={{borderRadius:12,padding:16,marginBottom:8,background:"#0f0f20",border:"1px solid #1a1a30",display:"flex",alignItems:"center",justifyContent:"space-between"}}><div><div style={{fontSize:12,fontWeight:700,color:"#e0e0e8"}}>Match #{l.id}</div><div style={{fontSize:10,color:"#555",marginTop:2}}>{l.cur}/{l.max} players · {fmt(l.wager)} MON each</div><div style={{fontSize:9,color:"#444",marginTop:2}}>{l.players.map(sa).join(", ")}</div>{youIn&&<div style={{fontSize:9,color:"#27AE60",marginTop:4}}>You are in this lobby</div>}</div>{wallet&&<button onClick={()=>join(l)} disabled={joining===l.id} style={{padding:"8px 20px",borderRadius:8,fontSize:12,fontWeight:700,background:joining===l.id?"#333":youIn?"#3498DB":"#27AE60",color:joining===l.id?"#666":"#fff",border:"none",cursor:joining===l.id?"wait":"pointer",display:"flex",alignItems:"center",gap:6}}>{joining===l.id&&<Spin/>}{youIn?"Re-enter":"Join ("+fmt(l.wager)+" $WHOT)"}</button>}</div>);})}</div>);
}

// ═══ ON-CHAIN LEADERBOARD ═══
function Leaderboard({rc}){
  const[data,setData]=useState([]);const[loading,setLoading]=useState(true);
  useEffect(()=>{if(!rc)return;(async()=>{try{const mc=Number(await rc.matchCount());const addrs=new Set();for(let i=1;i<=Math.min(mc,50);i++){try{const m=await rc.getMatch(i);m.players?.forEach(a=>{if(a!=="0x"+"0".repeat(40))addrs.add(a)})}catch{}}const rows=[];for(const a of addrs){try{const s=await rc.getPlayerStats(a);const w=Number(s.wins),l=Number(s.losses),gp=Number(s.gamesPlayed);rows.push({addr:a,w,l,gp,pts:w*100-l*30})}catch{}}rows.sort((a,b)=>b.pts-a.pts);setData(rows)}catch(e){console.error(e)}finally{setLoading(false)}})()},[rc]);
  if(loading)return<div style={{padding:32,textAlign:"center"}}><Spin/><p style={{fontSize:11,color:"#555",marginTop:12}}>Loading on-chain stats...</p></div>;
  if(!data.length)return<div style={{borderRadius:12,padding:32,textAlign:"center",background:"#0f0f20",border:"1px solid #1a1a30"}}><p style={{fontSize:13,fontWeight:700,color:"#555"}}>No matches played yet</p><p style={{fontSize:11,color:"#444",marginTop:4}}>Play a match to appear here.</p></div>;
  return(<div style={{borderRadius:12,overflow:"hidden",border:"1px solid #1a1a30"}}><div style={{display:"grid",gridTemplateColumns:"40px 1fr 60px 60px 80px",padding:"10px 16px",background:"#0a0a14",borderBottom:"1px solid #1a1a30"}}><span style={{fontSize:10,fontWeight:700,color:"#555"}}>#</span><span style={{fontSize:10,fontWeight:700,color:"#555"}}>WALLET</span><span style={{fontSize:10,fontWeight:700,color:"#555",textAlign:"center"}}>W/L</span><span style={{fontSize:10,fontWeight:700,color:"#555",textAlign:"center"}}>WIN%</span><span style={{fontSize:10,fontWeight:700,color:"#555",textAlign:"right"}}>PTS</span></div>{data.map((p,i)=>{const wr=p.gp>0?Math.round(p.w/p.gp*100):0;return(<div key={i} style={{display:"grid",gridTemplateColumns:"40px 1fr 60px 60px 80px",padding:"10px 16px",borderBottom:"1px solid #0a0a14",background:i===0?"#E9456008":"transparent",alignItems:"center"}}><span style={{fontSize:13,fontWeight:700,color:i===0?"#F39C12":i===1?"#aaa":i===2?"#CD7F32":"#555"}}>{i+1}</span><span style={{fontSize:12,fontWeight:700,color:"#e0e0e8",fontFamily:"monospace"}}>{sa(p.addr)}</span><span style={{fontSize:11,textAlign:"center",color:"#888"}}>{p.w}/{p.l}</span><span style={{fontSize:11,fontWeight:700,textAlign:"center",color:wr>=60?"#27AE60":wr>=40?"#F39C12":"#E74C3C"}}>{wr}%</span><span style={{fontSize:13,fontWeight:700,textAlign:"right",color:"#E94560",fontFamily:"monospace"}}>{p.pts}</span></div>)})}</div>);
}

// ═══ PAGES ═══
function LandingPage({onNavigate}){
  const features=[{icon:"\uD83C\uDCB4",title:"Nigerian Card Game",desc:"54-card WHOT with all special rules. 2-4 players."},{icon:"\uD83E\uDD16",title:"OpenClaw Agents",desc:"Every wallet gets an AI agent. Name it, let it compete."},{icon:"\u26D3",title:"Fully On-Chain",desc:"Real escrow, on-chain settlement, verifiable on Monad."}];
  return(<div style={{minHeight:"100vh",position:"relative",background:"linear-gradient(180deg,#06060e 0%,#0a0a18 40%,#0d0815 100%)"}}><FloatingCards/><nav style={{position:"relative",zIndex:10,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 24px",maxWidth:1100,margin:"0 auto"}}><div style={{display:"flex",alignItems:"center",gap:8}}><span style={{color:"#E94560",fontSize:24,fontWeight:900,fontFamily:"'Courier New',monospace"}}>WHOT</span><span style={{color:"#444",fontSize:24}}>Arena</span></div><button onClick={()=>onNavigate("play")} style={{padding:"8px 20px",borderRadius:8,fontSize:13,fontWeight:700,background:"#E94560",color:"#fff",border:"none",boxShadow:"0 0 20px #E9456044",cursor:"pointer"}}>Play</button></nav>
    <div style={{position:"relative",zIndex:10,maxWidth:1100,margin:"0 auto",padding:"64px 24px 32px",textAlign:"center"}}><div style={{display:"inline-block",marginBottom:24,padding:"6px 16px",borderRadius:99,fontSize:11,fontWeight:700,background:"#E9456015",color:"#E94560",border:"1px solid #E9456033"}}>Moltiverse Hackathon · Monad Mainnet</div><h1 style={{fontSize:"clamp(40px,7vw,72px)",fontWeight:900,fontFamily:"'Courier New',monospace",letterSpacing:-2,lineHeight:1.05,marginBottom:16}}><span style={{color:"#E94560"}}>WHOT</span><span style={{color:"#e0e0e8"}}> Arena</span></h1><p style={{fontSize:17,color:"#888",maxWidth:560,margin:"0 auto 8px",fontFamily:"Georgia,serif",fontStyle:"italic"}}>AI agents play the Nigerian card game WHOT with $WHOT token wagers on Monad</p><p style={{fontSize:13,color:"#444",marginBottom:40}}>2-4 Players · OpenClaw Agents · Fully On-Chain</p>
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:16,marginBottom:64,flexWrap:"wrap"}}><button onClick={()=>onNavigate("play")} style={{padding:"12px 32px",borderRadius:12,fontSize:14,fontWeight:700,background:"#E94560",color:"#fff",border:"none",boxShadow:"0 0 30px #E9456055",cursor:"pointer"}}>Play now</button><button onClick={()=>onNavigate("rules")} style={{padding:"12px 32px",borderRadius:12,fontSize:14,fontWeight:700,border:"1px solid #E9456055",color:"#E94560",background:"none",cursor:"pointer"}}>Rules</button></div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(250px,1fr))",gap:16,maxWidth:900,margin:"0 auto"}}>{features.map((f,i)=>(<div key={i} style={{borderRadius:12,padding:24,textAlign:"left",background:"linear-gradient(135deg,#0f0f20,#0a0a16)",border:"1px solid #1a1a30"}}><div style={{fontSize:24,marginBottom:12}}>{f.icon}</div><h3 style={{fontSize:13,fontWeight:700,color:"#e0e0e8",fontFamily:"'Courier New',monospace",marginBottom:8}}>{f.title}</h3><p style={{fontSize:11,lineHeight:1.5,color:"#666"}}>{f.desc}</p></div>))}</div></div>
    <div style={{position:"relative",zIndex:10,maxWidth:900,margin:"0 auto",padding:"32px 24px"}}><div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:48,flexWrap:"wrap"}}>{[{l:"Contract",v:sa(V2),c:"#E94560"},{l:"Chain",v:"Monad",c:"#9B59B6"},{l:"Agents",v:"OpenClaw",c:"#27AE60"},{l:"Token",v:"$WHOT",c:"#F39C12"}].map((s,i)=>(<div key={i} style={{textAlign:"center"}}><div style={{fontSize:11,color:"#444",marginBottom:4}}>{s.l}</div><div style={{fontSize:13,fontWeight:700,color:s.c,fontFamily:"monospace"}}>{s.v}</div></div>))}</div></div>
  </div>);
}

function RulesPage({onNavigate}){const rules=[{t:"The Deck",d:"54 cards: Circle, Square, Triangle, Cross (1-14), Star (1-8), 4 WHOT wildcards."},{t:"Play a Card",d:"Match by shape OR value. WHOT = wildcard, declare any shape."},{t:"Pick 2 & 3",d:"Value 2 = draw 2. Value 5 = draw 3. Stackable."},{t:"Suspension",d:"Value 8 skips next player's turn."},{t:"General Market",d:"Value 14 = all other players draw 1."},{t:"Star Cards",d:"Star 7=Pick 2, Star 8=Pick 3, Star 4-5=Suspension."},{t:"Winning",d:"First empty hand wins. If market empties, lowest hand score wins."},{t:"Players",d:"2-4 agents per game. Turn order is clockwise."},{t:"Wagering",d:"On-chain escrow on Monad. Winner claims 95% of pot."}];return(<div style={{minHeight:"100vh",background:"#06060e",color:"#e0e0e8"}}><nav style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 24px",maxWidth:900,margin:"0 auto"}}><button onClick={()=>onNavigate("home")} style={{display:"flex",alignItems:"center",gap:8,background:"none",border:"none",cursor:"pointer"}}><span style={{color:"#E94560",fontSize:20,fontWeight:900,fontFamily:"monospace"}}>WHOT</span><span style={{color:"#444",fontSize:20}}>Arena</span></button><button onClick={()=>onNavigate("play")} style={{padding:"8px 20px",borderRadius:8,fontSize:13,fontWeight:700,background:"#E94560",color:"#fff",border:"none",cursor:"pointer"}}>Play</button></nav><div style={{maxWidth:700,margin:"0 auto",padding:"48px 24px"}}><h1 style={{fontSize:28,fontWeight:700,fontFamily:"'Courier New',monospace",color:"#E94560",marginBottom:8}}>Rules of WHOT</h1><p style={{fontSize:13,color:"#555",marginBottom:32}}>Complete 2-4 player ruleset</p>{rules.map((r,i)=>(<div key={i} style={{borderRadius:12,padding:20,background:"#0f0f20",border:"1px solid #1a1a30",marginBottom:12}}><div style={{display:"flex",alignItems:"flex-start",gap:12}}><span style={{fontSize:11,fontWeight:700,padding:"4px 8px",borderRadius:4,background:"#E9456022",color:"#E94560",fontFamily:"monospace"}}>{String(i+1).padStart(2,"0")}</span><div><h3 style={{fontSize:13,fontWeight:700,marginBottom:4}}>{r.t}</h3><p style={{fontSize:11,lineHeight:1.6,color:"#777"}}>{r.d}</p></div></div></div>))}</div></div>)}

function GamePage({onNavigate}){
  const[tab,setTab]=useState("lobbies");const[rulesOk,setRulesOk]=useState(false);const[showRules,setShowRules]=useState(false);
  const[showAgent,setShowAgent]=useState(false);const[showCreate,setShowCreate]=useState(false);const[showGame,setShowGame]=useState(false);
  const[wallet,setWallet]=useState(null);const[myAgent,setMyAgent]=useState(null);
  const[gameWager,setGameWager]=useState(0);const[gameAgents,setGameAgents]=useState([]);const[gameMatchId,setGameMatchId]=useState(null);
  const[connecting,setConnecting]=useState(false);
  const[sContract,setSContract]=useState(null);const[rc,setRc]=useState(null);const[signer,setSigner]=useState(null);
  useEffect(()=>{try{setRc(readCon())}catch{}},[]);
  useEffect(()=>{if(wallet?.signer){setSContract(con(wallet.signer));setSigner(wallet.signer)}},[wallet]);
  useEffect(()=>{const n=getAgentName();if(n)setMyAgent({name:n})},[]);

  const doConnect=async()=>{setConnecting(true);try{setWallet(await connectWallet())}catch(e){alert(e.message)}finally{setConnecting(false)}};
  const handleCreate=()=>{if(!wallet){doConnect();return}if(!rulesOk){setShowRules(true);return}if(!myAgent){setShowAgent(true);return}setShowCreate(true)};
  const onCreated=(mid,pc,bet)=>{setGameMatchId(mid);setGameWager(parseFloat(bet));const ags=[{name:myAgent.name,address:wallet.address}];setGameAgents(ags);setShowCreate(false);setShowGame(true)};
  const onJoined=async(lobby)=>{
    if(isMatchClosed(lobby.id)){alert("This lobby has already ended.");return}
    // Always refresh lobby data from chain to get latest players
    let updatedLobby=lobby;
    if(rc){
      try{
        const m=await rc.getMatch(lobby.id);
        updatedLobby={
          id:Number(m.id),
          max:Number(m.maxPlayers),
          cur:Number(m.currentPlayers),
          wager:m.wagerPerPlayer,
          players:m.players||[]
        };
      }catch(e){console.error("Failed to refresh lobby:",e)}
    }
    setGameMatchId(updatedLobby.id);
    setGameWager(parseFloat(fmt(updatedLobby.wager)));
    const ags=updatedLobby.players.map(a=>{
      const isYou=wallet&&a.toLowerCase()===wallet.address.toLowerCase();
      return{
        name:isYou?(myAgent?.name||sa(a)):sa(a),
        address:a
      };
    });
    setGameAgents(ags);
    setShowGame(true);
  };

  if(showGame)return<GameView onBack={()=>setShowGame(false)} wagerAmt={gameWager} agents={gameAgents} matchId={gameMatchId} sContract={sContract} wallet={wallet} rc={rc}/>;
  if(showCreate)return<CreateLobby onBack={()=>setShowCreate(false)} onCreated={onCreated} wallet={wallet} sContract={sContract} signer={signer}/>;

  const ts=t=>({padding:"8px 20px",borderRadius:8,fontSize:13,fontWeight:700,background:tab===t?"#E9456022":"transparent",color:tab===t?"#E94560":"#555",border:tab===t?"1px solid #E9456044":"1px solid transparent",cursor:"pointer"});
  return(<div style={{minHeight:"100vh",background:"#06060e",color:"#e0e0e8",fontFamily:"monospace"}}>
    {showRules&&<RulesModal onClose={()=>setShowRules(false)} onAccept={()=>{setRulesOk(true);setShowRules(false);if(!myAgent)setShowAgent(true);else setShowCreate(true)}}/>}
    {showAgent&&<AgentModal onClose={()=>setShowAgent(false)} onDone={a=>{setMyAgent(a);setShowAgent(false);}} initialName={getAgentName()} wallet={wallet}/>}
    <nav style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"12px 24px",borderBottom:"1px solid #1a1a30"}}><button onClick={()=>onNavigate("home")} style={{display:"flex",alignItems:"center",gap:8,background:"none",border:"none",cursor:"pointer"}}><span style={{color:"#E94560",fontWeight:900}}>WHOT</span><span style={{color:"#444"}}>Arena</span></button>
      <div style={{display:"flex",gap:12,alignItems:"center"}}>
        {myAgent&&<><span style={{fontSize:11,padding:"4px 10px",borderRadius:6,color:"#E94560",background:"#E9456015",border:"1px solid #E9456033"}}>{myAgent.name}</span><button onClick={()=>setShowAgent(true)} style={{fontSize:10,padding:"3px 8px",borderRadius:4,color:"#888",background:"none",border:"1px solid #333",cursor:"pointer"}}>Edit</button></>}
        {wallet?<><span style={{fontSize:11,padding:"4px 12px",borderRadius:6,color:"#27AE60",background:"#27AE6015",border:"1px solid #27AE6033"}}>{sa(wallet.address)}</span><button onClick={()=>{setWallet(null);setMyAgent(null);setSContract(null);setSigner(null)}} style={{padding:"6px 16px",borderRadius:8,fontSize:11,border:"1px solid #333",color:"#888",background:"none",cursor:"pointer"}}>Disconnect</button></>
        :<button onClick={doConnect} disabled={connecting} style={{padding:"6px 16px",borderRadius:8,fontSize:11,fontWeight:700,background:"#27AE60",color:"#fff",border:"none",cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>{connecting&&<Spin/>}{connecting?"Connecting...":"Connect Wallet"}</button>}
      </div>
    </nav>
    <div style={{maxWidth:900,margin:"0 auto",padding:24}}>
      <div style={{display:"flex",gap:4,marginBottom:24}}><button onClick={()=>setTab("lobbies")} style={ts("lobbies")}>Open lobbies</button><button onClick={()=>setTab("live")} style={ts("live")}>Live games</button><button onClick={()=>setTab("leaderboard")} style={ts("leaderboard")}>Leaderboard</button></div>

      {!wallet&&tab!=="leaderboard"&&<div style={{borderRadius:12,padding:16,marginBottom:16,background:"#27AE6009",border:"1px solid #27AE6033"}}><p style={{fontSize:11,color:"#27AE60"}}>Connect your wallet to play on Monad mainnet.</p><button onClick={doConnect} disabled={connecting} style={{marginTop:8,padding:"6px 16px",borderRadius:8,fontSize:11,fontWeight:700,background:"#27AE60",color:"#fff",border:"none",cursor:"pointer"}}>Connect Wallet</button></div>}
      {wallet&&!rulesOk&&tab!=="leaderboard"&&<div style={{borderRadius:12,padding:16,marginBottom:16,background:"#F39C1209",border:"1px solid #F39C1233"}}><p style={{fontSize:11,color:"#F39C12"}}>Accept the WHOT rules before playing.</p><button onClick={()=>setShowRules(true)} style={{marginTop:8,padding:"6px 16px",borderRadius:8,fontSize:11,fontWeight:700,background:"#F39C12",color:"#000",border:"none",cursor:"pointer"}}>View rules</button></div>}
      {wallet&&!myAgent&&rulesOk&&tab!=="leaderboard"&&<div style={{borderRadius:12,padding:16,marginBottom:16,background:"#3498DB09",border:"1px solid #3498DB33"}}><p style={{fontSize:11,color:"#3498DB"}}>Setup your OpenClaw agent.</p><button onClick={()=>setShowAgent(true)} style={{marginTop:8,padding:"6px 16px",borderRadius:8,fontSize:11,fontWeight:700,background:"#3498DB",color:"#fff",border:"none",cursor:"pointer"}}>Setup Agent</button></div>}

      {tab==="lobbies"&&<div>
        <div style={{borderRadius:12,padding:16,marginBottom:16,textAlign:"center",background:"#0f0f20",border:"1px solid #1a1a30"}}><button onClick={handleCreate} style={{padding:"8px 24px",borderRadius:8,fontSize:13,fontWeight:700,color:"#E94560",border:"1px solid #E9456044",background:"none",cursor:"pointer"}}>+ Create lobby (on-chain)</button></div>
        <OpenLobbies rc={rc} sContract={sContract} wallet={wallet} onJoined={onJoined} signer={signer}/>
        <div style={{borderRadius:12,padding:24,textAlign:"center",background:"#0f0f20",border:"1px solid #1a1a30"}}><p style={{fontSize:11,color:"#444"}}>Lobbies are read from WhotArenaV2 on Monad.</p><a href={"https://monadscan.com/address/"+V2} target="_blank" rel="noreferrer" style={{fontSize:10,color:"#E94560"}}>{V2}</a></div>
      </div>}

      {tab==="live"&&<div><p style={{fontSize:13,color:"#888",marginBottom:12}}>Active matches from on-chain</p>{rc?<LiveMatches rc={rc}/>:<div style={{padding:32,textAlign:"center"}}><Spin/></div>}</div>}

      {tab==="leaderboard"&&<div><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}><div><h2 style={{fontSize:18,fontWeight:700,color:"#e0e0e8",marginBottom:4}}>Leaderboard</h2><p style={{fontSize:11,color:"#555"}}>On-chain stats from WhotArenaV2</p></div><a href={"https://monadscan.com/address/"+V2} target="_blank" rel="noreferrer" style={{fontSize:11,padding:"4px 12px",borderRadius:6,color:"#27AE60",background:"#27AE6015",border:"1px solid #27AE6033",textDecoration:"none"}}>View contract</a></div><Leaderboard rc={rc}/></div>}
    </div>
  </div>);
}

function LiveMatches({rc}){
  const[ms,setMs]=useState([]);const[ld,setLd]=useState(true);
  useEffect(()=>{if(!rc)return;(async()=>{try{const mc=Number(await rc.matchCount());const r=[];for(let i=mc;i>=Math.max(1,mc-20);i--){try{const m=await rc.getMatch(i);if(Number(m.state)===1)r.push({id:Number(m.id),max:Number(m.maxPlayers),cur:Number(m.currentPlayers),wager:m.wagerPerPlayer,players:m.players})}catch{}}setMs(r)}catch{}finally{setLd(false)}})()},[rc]);
  if(ld)return<div style={{padding:32,textAlign:"center"}}><Spin/></div>;
  if(!ms.length)return<div style={{borderRadius:12,padding:32,textAlign:"center",background:"#0f0f20",border:"1px solid #1a1a30"}}><p style={{fontSize:13,fontWeight:700,color:"#555"}}>No active matches</p><p style={{fontSize:11,color:"#444",marginTop:4}}>Active matches appear here.</p></div>;
  return<div>{ms.map(m=>(<div key={m.id} style={{borderRadius:12,padding:16,marginBottom:8,background:"#0f0f20",border:"1px solid #1a1a30"}}><div style={{fontSize:12,fontWeight:700,color:"#e0e0e8"}}>Match #{m.id}</div><div style={{fontSize:10,color:"#555",marginTop:2}}>{m.cur}/{m.max} players · {fmt(m.wager)} MON each</div></div>))}</div>;
}

export default function App(){const[page,setPage]=useState("home");switch(page){case"rules":return<RulesPage onNavigate={setPage}/>;case"play":return<GamePage onNavigate={setPage}/>;default:return<LandingPage onNavigate={setPage}/>}}

// @ts-nocheck
// VENDORED 1:1 from Beerio-Kart-Bracket (src/App.tsx). Deliberately not
// adapted to this repo's stricter tsconfig (noUncheckedIndexedAccess):
// rewriting 2,270 proven lines to satisfy it would risk behavior drift
// in a file whose whole job is to be identical to the original. Edits
// to this file should stay limited to sync-layer needs.
import "./beerio.css";
import { useState, useCallback, useEffect, useMemo, useRef, createContext, useContext } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";

// ─── Types ────────────────────────────────────────────────────────────────────

type SlotSeed  = { t: "seed"; n: number };
type SlotWin   = { t: "win";  m: string };
type SlotLose  = { t: "lose"; m: string };
type SlotSource = SlotSeed | SlotWin | SlotLose;

interface MatchDef {
  id: string; grp: string; bracket: "wb" | "lb" | "gf";
  drop?: string; a: SlotSource; b: SlotSource;
}
interface BracketGroup {
  key: string; title: string; bracket: "wb" | "lb" | "gf"; ids: string[];
}
export interface Bracket {
  defs: MatchDef[]; byId: Record<string, MatchDef>;
  groups: BracketGroup[]; k: number; S: number;
}
export interface Player { seed: number; name: string | null; }
const TBD: unique symbol = Symbol("TBD");
const BYE: { bye: true; name: "BYE"; seed?: undefined } = { bye: true, name: "BYE" };
export type Competitor = Player | typeof TBD | typeof BYE;
/** Narrow a Competitor to a real player (not TBD, not a BYE). */
export function isRealPlayer(c: Competitor): c is Player {
  return typeof c === "object" && c !== null && "seed" in c && (c as Player).seed !== undefined;
}
export interface MatchResult {
  a: Competitor; b: Competitor; winner: Competitor; loser: Competitor;
  decided: boolean; winSlot: "A" | "B" | null; auto: boolean;
  phantom: boolean; active: boolean; def: MatchDef;
}

// Race wins needed to take a match: 1 = single race, 2 = Best of 3, 3 = Best of 5
type SeriesLen = 1 | 2 | 3;
type Mode = "bracket" | "gp";        // bracket = 1v1 double-elim; gp = 4-kart Grand Prix
interface Format { series: SeriesLen; mode: Mode; gpRaces: number; }
type Series = Record<string, { a: number; b: number }>;
export interface SavedState {
  playerCount: number; names: string[];
  results: Record<string, "A" | "B">; series: Series; format: Format;
  gpLog: number[][];   // Grand Prix: each entry is one race's finishing order, as seed indices
  colors?: string[];   // per-seat racer color (parallel to names); optional for old saves
  seeded?: boolean;    // true = entry order is a real seeding; false = random draw night
  hofCode?: string;    // host's Hall of Fame crew code, shared so spectators can view it
}

// ─── Layout constants ─────────────────────────────────────────────────────────
const CARD_H    = 98;   // px — height of one compact match card
const CARD_W    = 186;  // px — width of match card column
const SLOT_BASE = 106;  // px — base slot height = CARD_H + inter-card gap (8 px)
const CONN_W    = 14;   // px — width of each connector arm
const LINE_CLR  = "rgba(22,35,59,0.2)";

const wbSlotH = (r: number) => SLOT_BASE * Math.pow(2, r - 1);
const lbSlotH = (i: number) => SLOT_BASE * Math.pow(2, Math.floor(i / 2));

// ─── Constants ────────────────────────────────────────────────────────────────
const MIN_PLAYERS = 2, MAX_PLAYERS = 16, DEFAULT_COUNT = 8;
const ITEM_ICONS  = ["🍄","🍌","⭐","🐢","💥","🔥","🪙"];
const STORAGE_KEY = "beerio-kart-state-v1";
const SESSION_KEY = "beerio-kart-session-v1";
const HOF_CODE_KEY  = "beerio-kart-hof-code-v1";
const HOF_CACHE_KEY = "beerio-kart-hof-cache-v1";
const HOF_FLAG_PREFIX = "bk-hof:";
const SID_KEY  = "beerio-kart-sid-v1";
const SPEC_NAME_KEY = "beerio-kart-spectator-name-v1";
const API = "/api";

// ─── GameNight OS binding (sync-layer, Session B of the port) ────────────────
// When launched from a GameNight event (/beerio?event=<id>), the setup screen
// prefills with the yes-RSVP crew, and completed tournaments report final
// standings back for lifetime stats. Standalone use (?event absent) behaves
// exactly like the original app.
// Read the event id LIVE, never cached at module scope. This file is
// statically imported by App.tsx, so a module-level const would be
// evaluated once at app boot against whatever URL loaded first (usually
// "/"), and would be null forever after a client-side navigation to
// /beerio?event=... . That silently killed both prefill and stat
// reporting. Read it per call instead.
function gnEvent(): string | null {
  if (typeof location === "undefined") return null;
  return new URLSearchParams(location.search).get("event");
}

// Client-side navigation, injected by the host app. A raw <a href> is a
// full page load, and in iOS standalone (home-screen) mode that breaks
// out into a new Safari tab. Falls back to location when unset.
let gnNavigator: ((to: string, replace?: boolean) => void) | null = null;
export function setBeerioNavigator(fn: (to: string, replace?: boolean) => void) {
  gnNavigator = fn;
}
function gnNavigate(to: string) {
  if (gnNavigator) gnNavigator(to, false);
  else location.href = to;
}
// Automatic bounces (a member on ?event= being sent into the host's ?s= live
// room) REPLACE the history entry instead of pushing one. Pushing left the
// /beerio?event= URL on the stack, so pressing back landed on it, its redirect
// effect re-fired, and you got shoved forward again unless you tapped back
// twice fast. Firefox exposed this (it won't back/forward-cache a page holding
// an open WebSocket, so the entry genuinely re-mounts and re-redirects); Safari
// served the stale entry frozen from bfcache and hid it. Replacing removes the
// entry at its source, so back works on the first press on every browser.
function gnRedirect(to: string) {
  if (gnNavigator) gnNavigator(to, true);
  else location.replace(to);
}

/** Set by the app so completion can surface what actually got recorded. */
let gnStatsNotice: ((msg: string) => void) | null = null;

function reportToGameNight(key: string, placements: { name: string; place: number }[]): void {
  const eventId = gnEvent();
  if (!eventId || placements.length === 0) return;
  fetch(`${API}/beerio-complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ eventId, key, placements }),
  })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => {
      if (!d || d.deduped || !gnStatsNotice) return;
      // Silence used to hide the guest trap: type a nickname that doesn't
      // match a crew display name and the night vanished from stats with
      // no explanation. Say so out loud.
      if (d.recorded === 0) {
        gnStatsNotice("No lifetime stats saved: none of these names match crew members.");
      } else if (d.guests > 0) {
        gnStatsNotice(`Saved to lifetime stats for ${d.recorded}. ${d.guests} guest${d.guests === 1 ? "" : "s"} not tracked.`);
      } else {
        gnStatsNotice(`Saved to lifetime stats for all ${d.recorded}.`);
      }
    })
    .catch(() => {/* stats are best-effort; the night itself never blocks on them */});
}

// ─── Racer colors ─────────────────────────────────────────────────────────────
// 32 vibrant kart colors, tuned for maximum hue separation. textOn() picks
// white or ink text per chip, so bright colors are fine.
const PALETTE = [
  "#E10600","#FF7A00","#FFC400","#9CCC00","#00C853","#00BFA5","#00B4E6","#2962FF",
  "#7C4DFF","#B620E0","#F50057","#FF6699","#8D6E63","#546E7A","#0D47A1","#33691E",
  "#FF5252","#FF9800","#FFE57F","#B2FF59","#69F0AE","#18FFFF","#40C4FF","#536DFE",
  "#AA00FF","#E040FB","#FF4081","#FFCCBC","#6D4C41","#455A64","#1A237E","#1B5E20",
];
const PALETTE_AUTO=PALETTE.slice(0,16); // vivid first-16 used for auto-assign; all 32 available in the picker
function shuffledColors(n: number): string[] {
  const pal=[...PALETTE_AUTO];
  for(let i=pal.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pal[i],pal[j]]=[pal[j],pal[i]];}
  return Array.from({length:n},(_,i)=>pal[i%pal.length]);
}
function normalizeColors(raw: unknown, n: number): string[] {
  // Also enforces uniqueness: if two seats claim the same color, the first keeps
  // it and later ones get the next free palette color.
  const base=Array.isArray(raw)?(raw as unknown[]).map(c=>typeof c==="string"&&/^#[0-9A-Fa-f]{6}$/.test(c)?c:""):[];
  const used=new Set<string>();
  const out:string[]=[];
  for(let i=0;i<n;i++){
    const want=base[i]&&!used.has(base[i])?base[i]:PALETTE_AUTO.find(pc=>!used.has(pc))||PALETTE_AUTO[i%PALETTE_AUTO.length];
    used.add(want);out.push(want);
  }
  return out;
}
// White or ink text depending on chip luminance.
function textOn(hex: string): string {
  const m=/^#?([0-9A-Fa-f]{6})$/.exec(hex); if(!m) return "#fff";
  const v=parseInt(m[1],16), r=(v>>16)&255,g=(v>>8)&255,b=v&255;
  return (0.299*r+0.587*g+0.114*b)>140?"var(--ink)":"#fff";
}
const ColorsCtx = createContext<string[]>([]);
function useRacerColor(seedIdx: number): string {
  const colors=useContext(ColorsCtx);
  return colors[seedIdx]||PALETTE[seedIdx%PALETTE.length];
}
const DEFAULT_FORMAT: Format = { series: 1, mode: "bracket", gpRaces: 3 };
type LiveStatus = "idle" | "connecting" | "live" | "error";

// ─── Grand Prix scoring (4-kart heats, points) ────────────────────────────────
const GP_POINTS = [3, 2, 1, 0];                         // 1st..4th
const gpPointsFor = (pos: number) => (pos >= 0 && pos < 4 ? GP_POINTS[pos] : 0);
const gpHeatSize = (realCount: number) => Math.min(4, Math.max(1, realCount));
function gpTotalRaces(realCount: number, target: number) {
  if (realCount < 2) return 0;
  return Math.ceil((realCount * target) / gpHeatSize(realCount));
}
function gpRaceCounts(realCount: number, gpLog: number[][]) {
  const c = new Array(realCount).fill(0);
  for (const r of gpLog) for (const s of r) if (s < realCount) c[s]++;
  return c;
}
// Next heat: the seeds who have raced the fewest times (ties: lower seed first)
function gpNextHeat(realCount: number, gpLog: number[][]) {
  const hs = gpHeatSize(realCount);
  const counts = gpRaceCounts(realCount, gpLog);
  return Array.from({ length: realCount }, (_, i) => i)
    .sort((a, b) => counts[a] - counts[b] || a - b)
    .slice(0, hs)
    .sort((a, b) => a - b);
}
export function gpComplete(realCount: number, target: number, gpLog: number[][]) {
  return realCount >= 2 && gpLog.length >= gpTotalRaces(realCount, target);
}
export interface GPStanding { seed: number; points: number; races: number; wins: number; rank: number; }
export function gpStandings(realCount: number, gpLog: number[][]): GPStanding[] {
  const rows: GPStanding[] = Array.from({ length: realCount }, (_, seed) => ({ seed, points: 0, races: 0, wins: 0, rank: 0 }));
  for (const r of gpLog) r.forEach((seed, pos) => {
    if (seed >= realCount) return;
    rows[seed].points += gpPointsFor(pos);
    rows[seed].races++;
    if (pos === 0) rows[seed].wins++;
  });
  rows.sort((a, b) => b.points - a.points || b.wins - a.wins || a.seed - b.seed);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}

// ─── Bracket engine ───────────────────────────────────────────────────────────
function nextPow2(n: number) { let s=1; while(s<n) s*=2; return Math.max(2,s); }
function seedOrder(S: number) {
  let pls=[1,2]; const rounds=Math.log2(S);
  for(let r=0;r<rounds-1;r++){
    const len=pls.length*2+1; const out:number[]=[];
    for(const d of pls){out.push(d);out.push(len-d);} pls=out;
  }
  return pls;
}
function roundTitleW(r:number,k:number){
  if(r===k)return"Winners Final"; if(r===k-1)return"Winners Semis"; return"Round "+r;
}
function roundTitleL(r:number,last:number){
  if(r===last)return"Losers Final"; if(r===last-1)return"Losers Semis"; return"Losers R"+r;
}

export function buildBracket(N: number): Bracket {
  const S=nextPow2(N), k=Math.log2(S);
  const defs:MatchDef[]=[], groups:BracketGroup[]=[], wbRounds:Record<number,string[]>={};
  const lbRoundForWB:Record<number,number>={1:1};
  for(let r=2;r<=k;r++) lbRoundForWB[r]=2*r-2;
  const lastLB=2*k-2, order=seedOrder(S);

  const ids1:string[]=[];
  for(let i=0;i<S/2;i++){
    const id=`W1M${i}`;
    const drop=lbRoundForWB[1]===lastLB?"L→LF":`L→LR${lbRoundForWB[1]}`;
    defs.push({id,grp:"W1",bracket:"wb",drop,a:{t:"seed",n:order[2*i]},b:{t:"seed",n:order[2*i+1]}});
    ids1.push(id);
  }
  wbRounds[1]=ids1; groups.push({key:"W1",title:roundTitleW(1,k),bracket:"wb",ids:ids1});

  for(let r=2;r<=k;r++){
    const ids:string[]=[]; const cnt=S/Math.pow(2,r); const prev=wbRounds[r-1];
    const drop=lbRoundForWB[r]===lastLB?"L→LF":`L→LR${lbRoundForWB[r]}`;
    for(let i=0;i<cnt;i++){
      const id=`W${r}M${i}`;
      defs.push({id,grp:`W${r}`,bracket:"wb",drop,a:{t:"win",m:prev[2*i]},b:{t:"win",m:prev[2*i+1]}});
      ids.push(id);
    }
    wbRounds[r]=ids; groups.push({key:`W${r}`,title:roundTitleW(r,k),bracket:"wb",ids});
  }

  let lbFinalId:string|null=null;
  if(k>=2){
    let lr=1;
    {
      const ids:string[]=[]; const cnt=S/4;
      for(let i=0;i<cnt;i++){
        const id=`L${lr}M${i}`;
        defs.push({id,grp:`L${lr}`,bracket:"lb",a:{t:"lose",m:ids1[2*i]},b:{t:"lose",m:ids1[2*i+1]}});
        ids.push(id);
      }
      groups.push({key:`L${lr}`,title:roundTitleL(lr,lastLB),bracket:"lb",ids});
      var prevL=ids; lr++;
    }
    for(let j=1;j<=k-1;j++){
      const wbLosers=wbRounds[j+1]; const cnt=prevL.length; const idsMaj:string[]=[];
      for(let i=0;i<cnt;i++){
        const id=`L${lr}M${i}`;
        defs.push({id,grp:`L${lr}`,bracket:"lb",a:{t:"win",m:prevL[i]},b:{t:"lose",m:wbLosers[cnt-1-i]}});
        idsMaj.push(id);
      }
      groups.push({key:`L${lr}`,title:roundTitleL(lr,lastLB),bracket:"lb",ids:idsMaj});
      prevL=idsMaj; lr++;
      if(j<k-1){
        const cnt2=prevL.length/2; const idsMin:string[]=[];
        for(let i=0;i<cnt2;i++){
          const id=`L${lr}M${i}`;
          defs.push({id,grp:`L${lr}`,bracket:"lb",a:{t:"win",m:prevL[2*i]},b:{t:"win",m:prevL[2*i+1]}});
          idsMin.push(id);
        }
        groups.push({key:`L${lr}`,title:roundTitleL(lr,lastLB),bracket:"lb",ids:idsMin});
        prevL=idsMin; lr++;
      }
    }
    lbFinalId=prevL[0];
  }
  const wbFinalId=wbRounds[k][0];
  const gfB:SlotSource=k>=2?{t:"win",m:lbFinalId!}:{t:"lose",m:wbFinalId};
  if(k<2){const d=defs.find(x=>x.id===wbFinalId);if(d)d.drop="L→GF";}
  defs.push({id:"GF", grp:"GF",bracket:"gf",a:{t:"win",m:wbFinalId},b:gfB});
  defs.push({id:"GF2",grp:"GF",bracket:"gf",a:{t:"win",m:wbFinalId},b:gfB});
  groups.push({key:"GF",title:"Grand Final",bracket:"gf",ids:["GF","GF2"]});
  const byId=Object.fromEntries(defs.map(d=>[d.id,d]));
  return{defs,byId,groups,k,S};
}

export function compute(BR:Bracket, names:string[], results:Record<string,"A"|"B">): Record<string,MatchResult> {
  const players:Player[]=names.map((n,i)=>({seed:i+1,name:n&&n.trim()?n.trim():null}));
  const M:Record<string,MatchResult>={};
  const resolve=(src:SlotSource):Competitor=>{
    if(src.t==="seed"){const p=players[src.n-1];return!p||p.name===null?BYE:p;}
    const m=M[src.m];if(!m||!m.decided)return TBD;
    return src.t==="win"?m.winner:m.loser;
  };
  for(const def of BR.defs){
    if(def.id==="GF2"){
      const gf=M["GF"],need=gf&&gf.decided&&gf.winSlot==="B";
      if(!need){M.GF2={a:TBD,b:TBD,winner:TBD,loser:TBD,decided:false,winSlot:null,auto:false,phantom:false,active:false,def};continue;}
    }
    const a=resolve(def.a),b=resolve(def.b);
    const aReal=a!==TBD&&a!==BYE,bReal=b!==TBD&&b!==BYE;
    let winner:Competitor=TBD,loser:Competitor=TBD,decided=false,winSlot:"A"|"B"|null=null,auto=false,phantom=false;
    if(a===BYE&&bReal){winner=b;loser=BYE;decided=true;winSlot="B";auto=true;}
    else if(b===BYE&&aReal){winner=a;loser=BYE;decided=true;winSlot="A";auto=true;}
    else if(a===BYE&&b===BYE){winner=BYE;loser=BYE;decided=true;winSlot="A";auto=true;phantom=true;}
    else if(aReal&&bReal){const r=results[def.id];if(r==="A"){winner=a;loser=b;decided=true;winSlot="A";}else if(r==="B"){winner=b;loser=a;decided=true;winSlot="B";}}
    M[def.id]={a,b,winner,loser,decided,winSlot,auto,phantom,active:true,def};
  }
  return M;
}

export function getChampion(M:Record<string,MatchResult>):Player|null{
  const isReal=(p:Competitor):p is Player=>p!==TBD&&p!==BYE;
  const gf=M["GF"],gf2=M["GF2"];
  if(gf&&gf.decided&&isReal(gf.winner)){
    if(gf.winSlot==="A")return gf.winner;
    if(gf2&&gf2.decided&&isReal(gf2.winner))return gf2.winner;
  }
  return null;
}
// Runner-up: the loser of whichever match actually decided the tournament (GF, or GF2 if reset happened)
function getRunnerUp(M:Record<string,MatchResult>):Player|null{
  const isReal=(p:Competitor):p is Player=>p!==TBD&&p!==BYE;
  const gf=M["GF"],gf2=M["GF2"];
  if(gf&&gf.decided&&isReal(gf.winner)){
    if(gf.winSlot==="A")return isReal(gf.loser)?gf.loser:null;
    if(gf2&&gf2.decided&&isReal(gf2.winner))return isReal(gf2.loser)?gf2.loser:null;
  }
  return null;
}
function itemIconFor(id:string){let h=0;for(let i=0;i<id.length;i++)h=(h*31+id.charCodeAt(i))>>>0;return ITEM_ICONS[h%ITEM_ICONS.length];}
function matchLabel(id:string){const m=id.match(/^([WL])(\d+)M(\d+)$/);if(m)return`${m[1]}${m[2]}·${+m[3]+1}`;return id;}

// Race wins needed for a given match under the chosen format (GF keeps its own mechanic = 1 tap)
function targetFor(def:MatchDef, fmt:Format){ return def.bracket==="gf" ? 1 : fmt.series; }

// Drop results / series that are no longer valid after a change
function pruneState(BR:Bracket,names:string[],results:Record<string,"A"|"B">,series:Series){
  let r={...results}; const s:Series={...series}; let changed=true;
  while(changed){
    changed=false; const M=compute(BR,names,r);
    for(const id in r){
      const m=M[id];
      if(!m||!(m.a!==TBD&&m.a!==BYE&&m.b!==TBD&&m.b!==BYE)){delete r[id];changed=true;}
    }
  }
  const M=compute(BR,names,r);
  for(const id in s){
    const m=M[id];
    if(!m||m.auto||!(m.a!==TBD&&m.a!==BYE&&m.b!==TBD&&m.b!==BYE)){delete s[id];}
  }
  return {results:r,series:s};
}

// ─── Compact Match Card ───────────────────────────────────────────────────────

function SlotRow({m,slot,onClick,wins,target,readOnly}:{
  m:MatchResult;slot:"A"|"B";onClick:(id:string,s:"A"|"B")=>void;
  wins:number;target:number;readOnly:boolean;
}){
  const comp=slot==="A"?m.a:m.b;
  const isTbd=comp===TBD,isBye=comp===BYE,isPlayer=!isTbd&&!isBye;
  const player=isPlayer?(comp as Player):null;
  const isWin=m.decided&&!m.phantom&&m.winSlot===slot;
  const isLose=m.decided&&!m.phantom&&m.winSlot!==slot&&isPlayer;
  const clickable=isPlayer&&!m.auto&&!readOnly;
  const lb=m.def.bracket==="lb",gf=m.def.bracket==="gf";
  const kartColor=useRacerColor(player?player.seed-1:0);
  let bg="#EDE8DC";
  if(isWin)bg=lb?"var(--coral)":gf?"var(--grape)":"var(--grass)";
  return(
    <button disabled={!clickable} onClick={()=>clickable&&onClick(m.def.id,slot)}
      style={{background:bg,borderLeft:`5px solid ${isPlayer?kartColor:"#C3CAD6"}`,touchAction:"manipulation"}}
      className={[
        "w-full flex items-center gap-1.5 px-2 py-[5px] rounded-[6px] border border-[var(--ink)]",
        "font-[Nunito] text-[11.5px] font-bold text-left transition-all",
        isWin?"text-white":"text-[var(--ink)]",
        isLose?"opacity-50":"",
        isTbd?"border-dashed !text-[#A4AEBF] cursor-default italic":"",
        isBye?"!text-[#9AA4B5] cursor-default":"",
        clickable?"hover:brightness-105 hover:-translate-y-px active:translate-y-0 cursor-pointer":"cursor-default",
      ].join(" ")}
    >
      <span className="inline-grid place-items-center min-w-[15px] h-[15px] rounded-[3px] text-[9.5px] font-bold flex-shrink-0 leading-none"
        style={isPlayer?{background:kartColor,color:textOn(kartColor),boxShadow:"inset 0 0 0 1px rgba(22,35,59,.35)"}:{background:"#C3CAD6",color:"#fff"}}>{isTbd||isBye?"·":player?.seed}</span>
      <span className={["flex-1 overflow-hidden text-ellipsis whitespace-nowrap leading-none",isLose?"line-through decoration-[var(--coral)] decoration-[1.5px]":""].join(" ")}>
        {isTbd?"Waiting…":isBye?"Bye":player?.name}
      </span>
      {target>1&&isPlayer&&(
        <span className="flex gap-[2px] items-center flex-shrink-0">
          {Array.from({length:target}).map((_,i)=>(
            <span key={i} className="w-[5px] h-[5px] rounded-full border"
              style={{borderColor:isWin?"rgba(255,255,255,.85)":"var(--ink)",
                background:i<wins?(isWin?"#fff":"var(--ink)"):"transparent"}}/>
          ))}
        </span>
      )}
      {isWin&&<span className="text-[9px] text-white leading-none flex-shrink-0">✔</span>}
    </button>
  );
}

function MatchCard({m,onSlotClick,label,seriesMap,format,readOnly,onReset}:{
  m:MatchResult;onSlotClick:(id:string,s:"A"|"B")=>void;label?:string;
  seriesMap:Series;format:Format;readOnly:boolean;onReset:(id:string)=>void;
}){
  const icon=itemIconFor(m.def.id), lbl=label??matchLabel(m.def.id);
  const target=targetFor(m.def,format);
  const sv=seriesMap[m.def.id]||{a:0,b:0};
  const showReset=!readOnly&&target>1&&!m.auto&&(sv.a+sv.b>0);
  return(
    <div style={{height:CARD_H}}
      className={["bg-white border border-[var(--ink)] rounded-[9px] p-1.5 flex flex-col justify-between",
        "shadow-[0_2px_0_rgba(22,35,59,.13)]",m.phantom?"opacity-40":""].join(" ")}>
      <div className="flex items-center justify-between gap-1">
        <span className="font-[Fredoka] font-bold text-[9.5px] tracking-wide text-[var(--ink)] bg-[#F5EFE0] border border-[var(--ink)] rounded-[3px] px-1 py-px leading-none">{lbl}</span>
        <div className="flex items-center gap-1 min-w-0">
          {m.def.drop&&<span className="font-[Nunito] text-[8.5px] font-bold text-[var(--muted)] leading-none truncate max-w-[78px]">{m.def.drop}</span>}
          {showReset&&(
            <button onClick={()=>onReset(m.def.id)} title="Reset this heat"
              style={{touchAction:"manipulation"}}
              className="text-[10px] leading-none text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer flex-shrink-0">↺</button>
          )}
        </div>
      </div>
      <SlotRow m={m} slot="A" onClick={onSlotClick} wins={sv.a} target={target} readOnly={readOnly}/>
      <div className="flex justify-center">
        <span className="font-[Fredoka] text-[8.5px] font-bold text-[var(--ink)] bg-[var(--sun)] border border-[var(--ink)] rounded-full px-1.5 leading-none py-px" style={{transform:"rotate(-2deg)"}}>{icon} vs</span>
      </div>
      <SlotRow m={m} slot="B" onClick={onSlotClick} wins={sv.b} target={target} readOnly={readOnly}/>
    </div>
  );
}

// ─── Bracket Column (slot-height layout + connector lines) ─────────────────────
interface ColProps {
  ids: string[]; M: Record<string, MatchResult>;
  onSlotClick: (id: string, s: "A"|"B") => void;
  slotH: number; rightConn: boolean; rightPair: boolean; leftConn: boolean;
  gfLabels?: Record<string,string>;
  seriesMap: Series; format: Format; readOnly: boolean; onReset: (id:string)=>void;
}

function BracketCol({ids,M,onSlotClick,slotH,rightConn,rightPair,leftConn,gfLabels,seriesMap,format,readOnly,onReset}:ColProps){
  const totalH = ids.length * slotH;
  const totalW = CARD_W + (leftConn?CONN_W:0) + (rightConn?CONN_W:0);
  return(
    <div style={{position:"relative",width:totalW,height:totalH,flexShrink:0}}>
      {ids.map((id,i)=>{
        const cy=(i+0.5)*slotH;
        return(
          <div key={id} style={{position:"absolute",top:cy-CARD_H/2,left:leftConn?CONN_W:0,width:CARD_W}}>
            <MatchCard m={M[id]} onSlotClick={onSlotClick} label={gfLabels?.[id]}
              seriesMap={seriesMap} format={format} readOnly={readOnly} onReset={onReset}/>
          </div>
        );
      })}
      {leftConn&&ids.map((_,i)=>{
        const cy=(i+0.5)*slotH;
        return <div key={i} style={{position:"absolute",left:0,top:cy-1,width:CONN_W,height:2,background:LINE_CLR}}/>;
      })}
      {rightConn&&ids.map((_,i)=>{
        const cy=(i+0.5)*slotH;
        return <div key={i} style={{position:"absolute",right:0,top:cy-1,width:CONN_W,height:2,background:LINE_CLR}}/>;
      })}
      {rightConn&&rightPair&&Array.from({length:Math.floor(ids.length/2)},(_,pi)=>{
        const topY=(2*pi+0.5)*slotH, botY=(2*pi+1.5)*slotH;
        return <div key={pi} style={{position:"absolute",right:0,top:topY,width:2,height:botY-topY,background:LINE_CLR}}/>;
      })}
    </div>
  );
}

// ─── Bracket Section ──────────────────────────────────────────────────────────
interface SectionProps {
  groups: BracketGroup[]; M: Record<string,MatchResult>;
  onSlotClick: (id:string,s:"A"|"B")=>void;
  tagColor: string; tagText: string; pipColor: string;
  slotHFor: (i:number)=>number; rightConnFor: (i:number)=>boolean; rightPairFor: (i:number)=>boolean;
  seriesMap: Series; format: Format; readOnly: boolean; onReset: (id:string)=>void;
}

function BracketSection({groups,M,onSlotClick,tagColor,tagText,pipColor,slotHFor,rightConnFor,rightPairFor,seriesMap,format,readOnly,onReset}:SectionProps){
  return(
    <section className="mt-5">
      <div className="flex items-center gap-3 mb-2.5">
        <span className="w-3 h-3 border-2 border-[var(--ink)] rotate-45 rounded-sm flex-shrink-0" style={{background:pipColor}}/>
        <span className="font-[Luckiest_Guy,cursive] text-[17px] tracking-wider text-white rounded-[9px] px-3 py-0.5 shadow-[0_3px_0_rgba(22,35,59,.22)] flex-shrink-0"
          style={{background:tagColor,border:"2px solid var(--ink)",transform:"rotate(-1deg)"}}>{tagText}</span>
        <span className="h-[2px] bg-[var(--ink)] opacity-15 flex-1 rounded"/>
      </div>
      <div className="flex overflow-x-auto pb-2 items-start" style={{scrollbarWidth:"thin",scrollbarColor:"#C9BFA8 transparent"}}>
        {groups.map((g,gi)=>{
          const slotH=slotHFor(gi);
          const right=rightConnFor(gi);
          const pair=rightPairFor(gi);
          const left=gi>0&&rightConnFor(gi-1)&&rightPairFor(gi-1);
          return(
            <div key={g.key} className="flex-shrink-0 flex flex-col">
              <div className="font-[Fredoka] text-[10.5px] font-bold text-[var(--ink-soft)] pb-1 border-b border-dotted border-[#C9BFA8] mb-1.5"
                style={{marginLeft:left?CONN_W:0,width:CARD_W}}>
                {g.title}
              </div>
              <BracketCol
                ids={g.ids} M={M} onSlotClick={onSlotClick}
                slotH={slotH} rightConn={right} rightPair={pair} leftConn={left}
                seriesMap={seriesMap} format={format} readOnly={readOnly} onReset={onReset}/>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Beer Mug SVG ─────────────────────────────────────────────────────────────
function BeerMug({pct}:{pct:number}){
  const TOP=8,BOT=62,MUG_H=BOT-TOP;
  const fillH=Math.max(0,(pct/100)*MUG_H);
  const fillY=BOT-fillH;
  const show=fillH>0.5;
  const FOAM=9;
  return(
    <svg viewBox="0 0 56 72" width="44" height="58" style={{flexShrink:0,overflow:"visible"}}>
      <defs>
        <linearGradient id="beerGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFD055"/>
          <stop offset="60%" stopColor="#FFA820"/>
          <stop offset="100%" stopColor="#D4700A"/>
        </linearGradient>
        <clipPath id="mugClip"><polygon points="5,7 49,7 44,64 10,64"/></clipPath>
        <clipPath id="beerClip"><rect x="0" y={fillY} width="56" height={fillH+2}/></clipPath>
      </defs>
      <polygon points="5,7 49,7 44,64 10,64" fill="rgba(200,230,255,0.18)"/>
      {show&&(
        <rect x="0" width="56" clipPath="url(#mugClip)" fill="url(#beerGrad)"
          style={{y:`${fillY}px`,height:`${fillH+8}px`,transition:"y .55s ease, height .55s ease"} as React.CSSProperties}/>
      )}
      {show&&(
        <g clipPath="url(#mugClip)"
          style={{transform:`translateY(${fillY-FOAM}px)`,transition:"transform .55s ease",
            animation:"foamOscillate 3.2s ease-in-out infinite",transformOrigin:"27px 0px"}}>
          <rect x="0" y="0" width="56" height={FOAM+4} fill="white" opacity="0.96"/>
          {[6,11,16,21,26,31,36,41,46].map((cx,i)=>(<circle key={i} cx={cx} cy={1} r={5} fill="white" opacity="0.95"/>))}
          {[3,9,15,21,27,33,39,45].map((cx,i)=>(<circle key={i} cx={cx} cy={-2} r={3.2} fill="white" opacity="0.7"/>))}
        </g>
      )}
      {show&&fillH>12&&(
        <g clipPath="url(#mugClip)">
          <circle cx="21" cy={BOT-6} r="2.2" fill="rgba(255,255,255,0.55)" style={{animation:"beerBubble1 2.4s ease-in infinite"}}/>
          <circle cx="31" cy={BOT-3} r="1.5" fill="rgba(255,255,255,0.45)" style={{animation:"beerBubble2 3s ease-in .9s infinite"}}/>
          <circle cx="26" cy={BOT-10} r="1.8" fill="rgba(255,255,255,0.4)" style={{animation:"beerBubble3 2.7s ease-in 1.7s infinite"}}/>
        </g>
      )}
      <polygon points="5,7 49,7 44,64 10,64" fill="none" stroke="#16233B" strokeWidth="2.5" strokeLinejoin="round"/>
      <path d="M 49 22 C 62 22 62 52 49 52" fill="none" stroke="#16233B" strokeWidth="3" strokeLinecap="round"/>
      <path d="M 49 27 C 57 27 57 47 49 47" fill="rgba(255,255,255,0.4)" stroke="#16233B" strokeWidth="1.5" strokeLinecap="round"/>
      <line x1="5" y1="7" x2="49" y2="7" stroke="#16233B" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}

// ─── Rules Modal ──────────────────────────────────────────────────────────────
const RULES = [
  {icon:"🚗",title:"No Drinking While Moving",body:"You can drink during the race, but only while your kart is stopped. Pull over, take your sips, then get back in it."},
  {icon:"🍺",title:"Finish Before You Cross",body:"Your drink must be completely finished before you cross the finish line. Cross with liquid left and your finish doesn't count, so pull back and chug."},
  {icon:"🎮",title:"Two Ways To Play",body:"Pick a mode in Settings (⚙️). Bracket is a 1v1 double-elimination ladder. Grand Prix is 4-kart heats where everyone races for points. Switching modes starts a fresh tournament."},
  {icon:"🏁",title:"Bracket: Double Elimination",body:"Two racers per match. Your first loss drops you to the Losers Bracket; a second loss knocks you out. The Losers champ fights back to the Grand Final. Set match length to single race, Best of 3, or Best of 5."},
  {icon:"⭐",title:"Bracket: Grand Final",body:"The Winners Bracket champ starts the Grand Final one game up. Win the next game and it's over. If the Losers champ takes it, the score levels and one final game decides everything."},
  {icon:"🏎️",title:"Grand Prix: 4-Kart Heats",body:"Up to four race each heat. The app builds balanced heats so everyone races the same number of times. Tap racers in finishing order to score a heat."},
  {icon:"🏆",title:"Grand Prix: Points",body:"Each heat awards 3 points for 1st, 2 for 2nd, 1 for 3rd, 0 for 4th. Points stack across all heats. Most points when the Grand Prix ends wins. Ties break by number of heat wins."},
  {icon:"🏠",title:"House Rules",body:"Agree on tracks before each race and add your own rules before the first race. Blue shells, rubber cup holders, whatever you all agree on is law."},
];
function RulesModal({onClose}:{onClose:()=>void}){
  return(
    <ModalShell onClose={onClose} title="🍺 BEERIO KART RULES" subtitle="Read before you race. Seriously.">
      <div className="px-5 py-4 flex flex-col gap-3">
        {RULES.map((r,i)=>(
          <div key={i} className="flex gap-3 bg-white border-2 border-[var(--ink)] rounded-[12px] p-3 shadow-[0_2px_0_rgba(22,35,59,.1)]">
            <span className="text-2xl flex-shrink-0 mt-0.5">{r.icon}</span>
            <div>
              <div className="font-[Fredoka] font-bold text-[14px] text-[var(--ink)] leading-tight mb-1">{r.title}</div>
              <p className="font-[Nunito] text-[12.5px] font-semibold text-[var(--ink-soft)] leading-relaxed m-0">{r.body}</p>
            </div>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}

// ─── Shared Modal shell ───────────────────────────────────────────────────────
function ModalShell({title,subtitle,onClose,children}:{title:string;subtitle?:string;onClose:()=>void;children:React.ReactNode}){
  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{background:"rgba(22,35,59,0.6)",backdropFilter:"blur(4px)"}}
      onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div className="relative w-full max-w-lg max-h-[85vh] flex flex-col bg-[var(--foam)] border-[3px] border-[var(--ink)] rounded-[18px] shadow-[0_8px_0_rgba(22,35,59,.3)]" style={{overflowY:"auto"}}>
        <div className="sticky top-0 z-10 bg-[var(--sun)] border-b-[3px] border-[var(--ink)] px-5 py-3 flex items-center justify-between rounded-t-[15px]">
          <div>
            <h2 className="font-[Luckiest_Guy,cursive] text-[20px] text-[var(--ink)] leading-none tracking-wider m-0" style={{textShadow:"2px 2px 0 rgba(22,35,59,.15)"}}>{title}</h2>
            {subtitle&&<p className="font-[Fredoka] font-semibold text-[11px] text-[var(--ink)] opacity-70 mt-0.5 m-0 tracking-wide">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-[8px] border-2 border-[var(--ink)] bg-white text-[var(--ink)] font-bold text-lg grid place-items-center shadow-[0_2px_0_rgba(22,35,59,.22)] hover:bg-[#F5EFE0] active:translate-y-px transition-all cursor-pointer" style={{touchAction:"manipulation"}}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Format / Settings Modal ──────────────────────────────────────────────────
function FormatModal({format,onChange,onClose}:{format:Format;onChange:(f:Partial<Format>,resetNeeded:boolean)=>void;onClose:()=>void}){
  const modeOpts:{v:Mode;label:string;sub:string;icon:string}[]=[
    {v:"bracket",icon:"🏁",label:"Bracket",sub:"1v1 double-elimination ladder"},
    {v:"gp",icon:"🏎️",label:"Grand Prix",sub:"4-kart heats, race for points"},
  ];
  const seriesOpts:{v:SeriesLen;label:string;sub:string}[]=[
    {v:1,label:"Single race",sub:"One race per match"},
    {v:2,label:"Best of 3",sub:"First to 2 race wins"},
    {v:3,label:"Best of 5",sub:"First to 3 race wins"},
  ];
  const gpOpts:{v:number;label:string;sub:string}[]=[
    {v:3,label:"Short (3 each)",sub:"Everyone races at least 3 heats"},
    {v:4,label:"Standard (4 each)",sub:"Everyone races at least 4 heats"},
    {v:5,label:"Long (5 each)",sub:"Everyone races at least 5 heats"},
  ];
  const Row=({active,onClick,icon,label,sub}:{active:boolean;onClick:()=>void;icon?:string;label:string;sub:string})=>(
    <button onClick={onClick} style={{touchAction:"manipulation"}}
      className={`flex items-center justify-between text-left px-3 py-2 rounded-[10px] border-2 border-[var(--ink)] cursor-pointer transition-all ${active?"bg-[var(--sun)] shadow-[0_2px_0_rgba(22,35,59,.22)]":"bg-white hover:bg-[#F5EFE0]"}`}>
      <span className="flex items-center gap-2">
        {icon&&<span className="text-[17px]">{icon}</span>}
        <span><span className="font-[Fredoka] font-bold text-[13px] text-[var(--ink)]">{label}</span><span className="block font-[Nunito] text-[11px] font-semibold text-[var(--muted)]">{sub}</span></span>
      </span>
      {active&&<span className="text-[var(--ink)] font-bold">✓</span>}
    </button>
  );
  return(
    <ModalShell onClose={onClose} title="⚙️ FORMAT" subtitle="Set this before you start racing.">
      <div className="px-5 py-4 flex flex-col gap-5">
        <div>
          <div className="font-[Fredoka] font-bold text-[13px] text-[var(--ink)] mb-2">Tournament mode</div>
          <div className="flex flex-col gap-2">
            {modeOpts.map(o=>(
              <Row key={o.v} active={format.mode===o.v} icon={o.icon} label={o.label} sub={o.sub}
                onClick={()=>onChange({mode:o.v}, o.v!==format.mode)}/>
            ))}
          </div>
          <p className="font-[Nunito] text-[10.5px] font-semibold text-[var(--muted)] mt-1.5 leading-snug">Switching modes starts a fresh tournament.</p>
        </div>

        {format.mode==="bracket"?(
          <div>
            <div className="font-[Fredoka] font-bold text-[13px] text-[var(--ink)] mb-2">Match length</div>
            <div className="flex flex-col gap-2">
              {seriesOpts.map(o=>(
                <Row key={o.v} active={format.series===o.v} label={o.label} sub={o.sub}
                  onClick={()=>onChange({series:o.v}, o.v!==format.series)}/>
              ))}
            </div>
            <p className="font-[Nunito] text-[10.5px] font-semibold text-[var(--muted)] mt-1.5 leading-snug">Changing match length clears recorded results. The Grand Final always uses the winners-bracket head start.</p>
          </div>
        ):(
          <div>
            <div className="font-[Fredoka] font-bold text-[13px] text-[var(--ink)] mb-2">Grand Prix length</div>
            <div className="flex flex-col gap-2">
              {gpOpts.map(o=>(
                <Row key={o.v} active={format.gpRaces===o.v} label={o.label} sub={o.sub}
                  onClick={()=>onChange({gpRaces:o.v}, o.v!==format.gpRaces)}/>
              ))}
            </div>
            <p className="font-[Nunito] text-[10.5px] font-semibold text-[var(--muted)] mt-1.5 leading-snug">3 points for 1st, 2 for 2nd, 1 for 3rd, 0 for 4th. Most points wins. Changing length clears recorded heats.</p>
          </div>
        )}
      </div>
    </ModalShell>
  );
}

// ─── Share / Spectator (QR) Modal ─────────────────────────────────────────────
function CopyRow({value,id,copied,onCopy}:{value:string;id:"live"|"snap";copied:""|"live"|"snap";onCopy:(id:"live"|"snap",v:string)=>void}){
  return(
    <div className="w-full flex items-center gap-2">
      <input readOnly value={value} onFocus={e=>e.currentTarget.select()}
        className="flex-1 min-w-0 px-2.5 py-2 bg-white border-2 border-[var(--ink)] rounded-[9px] font-[Nunito] text-[11px] font-semibold text-[var(--ink-soft)] outline-none truncate"/>
      <button onClick={()=>onCopy(id,value)} style={{touchAction:"manipulation"}}
        className="flex-shrink-0 px-3 py-2 rounded-[9px] border-2 border-[var(--ink)] bg-[var(--sun)] hover:bg-[var(--sun-deep)] font-[Fredoka] font-semibold text-[12px] text-[var(--ink)] shadow-[0_2px_0_rgba(22,35,59,.22)] active:translate-y-px transition-all cursor-pointer">
        {copied===id?"Copied!":"Copy"}
      </button>
    </div>
  );
}

function ShareModal({code,status,liveUrl,snapshotUrl,onClose,onRetry}:{
  code:string|null;status:LiveStatus;liveUrl:string;snapshotUrl:string;onClose:()=>void;onRetry:()=>void;
}){
  const [copied,setCopied]=useState<""|"live"|"snap">("");
  const copy=async(id:"live"|"snap",val:string)=>{
    try{await navigator.clipboard.writeText(val);setCopied(id);setTimeout(()=>setCopied(""),1500);}catch{/* clipboard blocked */}
  };
  return(
    <ModalShell onClose={onClose} title="📺 SPECTATOR VIEW" subtitle="Scan to follow the bracket live on another screen.">
      <div className="px-5 py-5 flex flex-col items-center gap-4">
        {status==="connecting"&&!code&&(
          <div className="py-10 flex flex-col items-center gap-3">
            <span className="text-3xl animate-pulse">📡</span>
            <p className="font-[Fredoka] font-semibold text-[13px] text-[var(--muted)] m-0">Starting live session…</p>
          </div>
        )}
        {status==="error"&&!code&&(
          <div className="w-full flex flex-col items-center gap-3 text-center">
            <span className="text-3xl">🔌</span>
            <p className="font-[Nunito] font-semibold text-[12.5px] text-[var(--ink-soft)] m-0 leading-relaxed">
              Couldn't reach the live server. Make sure the app is running with its API server (see setup notes), or use the one-time snapshot link below.
            </p>
            <button onClick={onRetry} style={{touchAction:"manipulation"}}
              className="px-4 py-2 rounded-[9px] border-2 border-[var(--ink)] bg-[var(--sun)] hover:bg-[var(--sun-deep)] font-[Fredoka] font-semibold text-[12.5px] text-[var(--ink)] shadow-[0_2px_0_rgba(22,35,59,.22)] active:translate-y-px transition-all cursor-pointer">
              Try again
            </button>
          </div>
        )}
        {code&&(
          <>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{background:status==="live"?"var(--grass)":"var(--coral)",boxShadow:"0 0 0 2px rgba(22,35,59,.15)"}}/>
              <span className="font-[Fredoka] font-bold text-[12.5px] text-[var(--ink)] tracking-wide">{status==="live"?"LIVE":"reconnecting…"} · Room {code}</span>
            </div>
            <div className="bg-white border-[3px] border-[var(--ink)] rounded-[14px] p-3 shadow-[0_3px_0_rgba(22,35,59,.18)]">
              <QRCodeSVG value={liveUrl} size={196} bgColor="#FFFFFF" fgColor="#16233B" level="M" includeMargin={false}/>
            </div>
            <p className="font-[Nunito] text-[12px] font-semibold text-[var(--muted)] text-center leading-relaxed m-0">
              Scan to watch the bracket update in real time as you record results. Anyone with the link follows along live, but can't edit.
            </p>
            <CopyRow value={liveUrl} id="live" copied={copied} onCopy={copy}/>
          </>
        )}
        <details className="w-full">
          <summary className="cursor-pointer font-[Nunito] text-[11px] font-bold text-[var(--muted)] select-none">One-time snapshot link (no live updates)</summary>
          <p className="font-[Nunito] text-[10.5px] font-semibold text-[var(--muted)] mt-1.5 mb-2 leading-snug">A frozen copy of the bracket right now. Works without the server, but won't refresh.</p>
          <CopyRow value={snapshotUrl} id="snap" copied={copied} onCopy={copy}/>
        </details>
      </div>
    </ModalShell>
  );
}

// ─── Floating "join live" QR ───────────────────────────────────────────────────
// Stays on screen at all times once a live room exists, so anyone nearby can scan
// in without the host hunting for the share button. Portaled to <body> so scroll
// position never affects it. Offset up from the corner so it clears the
// bottom edge and the mobile home indicator.
function FloatingQR({liveUrl,status,canGoLive,isSpectator,onGoLive,onOpen}:{
  liveUrl:string;status:LiveStatus;canGoLive:boolean;isSpectator:boolean;onGoLive:()=>void;onOpen:()=>void;
}){
  const [copied,setCopied]=useState(false);
  const wrapStyle:React.CSSProperties={
    position:"fixed",
    right:"max(14px, env(safe-area-inset-right))",
    bottom:"calc(82px + env(safe-area-inset-bottom))",
    zIndex:40,
  };
  if(!liveUrl){
    if(!canGoLive)return null;
    return createPortal(
      <button onClick={onGoLive} style={{...wrapStyle,touchAction:"manipulation"}}
        className="flex items-center gap-2 font-[Fredoka] font-bold text-[12px] text-[var(--ink)] bg-[var(--foam)] border-2 border-[var(--ink)] rounded-full pl-3 pr-4 py-2.5 shadow-[0_4px_0_rgba(22,35,59,.25)] hover:bg-white active:translate-y-px transition-all cursor-pointer">
        📺 Go live
      </button>,
      document.body
    );
  }
  // Spectators can't (and shouldn't) start/own a live session — tapping just copies the link.
  const handleTap=async()=>{
    if(isSpectator){
      try{await navigator.clipboard.writeText(liveUrl);setCopied(true);setTimeout(()=>setCopied(false),1400);}catch{/* clipboard blocked */}
      return;
    }
    onOpen();
  };
  return createPortal(
    <button onClick={handleTap} title={isSpectator?"Tap to copy the join link":"Tap to scan or copy the join link"} style={{...wrapStyle,touchAction:"manipulation"}}
      className="flex flex-col items-center gap-1 bg-[var(--foam)] border-[3px] border-[var(--ink)] rounded-[14px] p-1.5 shadow-[0_4px_0_rgba(22,35,59,.28)] hover:bg-white active:translate-y-px transition-all cursor-pointer">
      <QRCodeSVG value={liveUrl} size={68} bgColor="#FFFFFF" fgColor="#16233B" level="M" includeMargin={false}/>
      <span className="flex items-center gap-1.5 font-[Fredoka] font-bold text-[8px] text-[var(--ink-soft)] tracking-wider uppercase">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{background:status==="live"?"var(--grass)":"var(--coral)"}}/>
        {copied?"Copied!":"Join live"}
      </span>
    </button>,
    document.body
  );
}


function MatchHistory({BR,M,series,groupTitleById}:{BR:Bracket;M:Record<string,MatchResult>;series:Series;groupTitleById:Record<string,string>}){
  const [open,setOpen]=useState(false);
  const rows=BR.defs
    .filter(d=>{const m=M[d.id];return m&&m.active&&m.decided&&!m.auto&&!m.phantom;})
    .map(d=>{
      const m=M[d.id];
      const w=m.winner as Player;
      const lname=(m.loser!==TBD&&m.loser!==BYE)?(m.loser as Player).name:"Bye";
      const round=d.bracket==="gf"?(d.id==="GF2"?"Grand Final (Reset)":"Grand Final"):`${groupTitleById[d.id]} · ${matchLabel(d.id)}`;
      const sv=series[d.id];
      const score=sv&&(sv.a+sv.b>0)?(m.winSlot==="A"?`${sv.a}–${sv.b}`:`${sv.b}–${sv.a}`):null;
      return {id:d.id,round,winner:w.name,loser:lname,score};
    });
  if(rows.length===0)return null;
  return(
    <div className="mt-6 border-t-2 border-dotted border-[#C9BFA8] pt-3">
      <button onClick={()=>setOpen(o=>!o)} style={{touchAction:"manipulation"}}
        className="w-full flex items-center justify-between font-[Fredoka] font-bold text-[13px] text-[var(--ink)] cursor-pointer py-1">
        <span>📜 Match History <span className="text-[var(--muted)] font-semibold">({rows.length})</span></span>
        <span className={`transition-transform ${open?"rotate-90":""}`}>▸</span>
      </button>
      {open&&(
        <div className="mt-2 flex flex-col gap-1.5">
          {rows.map((r,i)=>(
            <div key={r.id} className="flex items-center gap-2 bg-white border border-[var(--ink)] rounded-[8px] px-2.5 py-1.5 shadow-[0_1px_0_rgba(22,35,59,.1)]">
              <span className="font-[Fredoka] font-bold text-[9px] text-[var(--ink-soft)] w-5 flex-shrink-0">{i+1}</span>
              <span className="font-[Fredoka] font-bold text-[9.5px] text-[var(--ink)] bg-[#F5EFE0] border border-[var(--ink)] rounded-[3px] px-1.5 py-px leading-none flex-shrink-0 min-w-[92px]">{r.round}</span>
              <span className="font-[Nunito] text-[12px] font-bold text-[var(--ink)] flex-1 min-w-0 truncate">
                <span className="text-[var(--grass-deep)]">{r.winner}</span>
                <span className="text-[var(--muted)] font-semibold"> def. </span>
                <span className="text-[var(--ink-soft)]">{r.loser}</span>
              </span>
              {r.score&&<span className="font-[Fredoka] font-bold text-[11px] text-[var(--ink)] flex-shrink-0">{r.score}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Victory celebration: centered popup modal + confetti + chime ─────────────
const CONFETTI_COLORS = ["var(--sun)","var(--grass)","var(--coral)","var(--grape)","#fff"];
const CELEBRATED_PREFIX = "bk-celebrated:";

// Full-viewport confetti rain (rendered into the modal portal, not clipped to the card)
function Confetti({burstKey}:{burstKey:string}){
  // Re-randomize only when the burst key changes (i.e. a new champion is crowned)
  const pieces=useMemo(()=>Array.from({length:34},(_,i)=>({
    id:i,
    left:Math.random()*100,
    delay:Math.random()*0.4,
    duration:2.2+Math.random()*1.5,
    drift:(Math.random()*90-45),
    fall:58+Math.random()*38, // vh — guarantees it crosses the full screen on any device
    size:5+Math.random()*5,
    color:CONFETTI_COLORS[i%CONFETTI_COLORS.length],
    spin:Math.random()*360,
  })),[burstKey]);
  return(
    <div className="confetti-field" aria-hidden="true">
      {pieces.map(p=>(
        <span key={p.id} className="confetti-piece" style={{
          left:`${p.left}%`,
          width:p.size,height:p.size*0.42,
          background:p.color,
          animationDelay:`${p.delay}s`,
          animationDuration:`${p.duration}s`,
          ["--drift" as any]:`${p.drift}px`,
          ["--spin" as any]:`${p.spin}deg`,
          ["--fall" as any]:`${p.fall}vh`,
        }}/>
      ))}
    </div>
  );
}

// Tiny built-in victory chime, no audio file needed. Best-effort; never throws.
function playVictoryChime(){
  try{
    const Ctx=(window as any).AudioContext||(window as any).webkitAudioContext;
    if(!Ctx)return;
    const ctx=new Ctx();
    const notes=[523.25,659.25,783.99,1046.5]; // C5 E5 G5 C6
    notes.forEach((freq,i)=>{
      const t=ctx.currentTime+i*0.11;
      const osc=ctx.createOscillator();
      const gain=ctx.createGain();
      osc.type="triangle";
      osc.frequency.setValueAtTime(freq,t);
      gain.gain.setValueAtTime(0,t);
      gain.gain.linearRampToValueAtTime(0.18,t+0.02);
      gain.gain.exponentialRampToValueAtTime(0.001,t+0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);osc.stop(t+0.55);
    });
    setTimeout(()=>ctx.close().catch(()=>{}),900);
  }catch{/* best effort, silent */}
}

// Drives the champion popup. The first time THIS DEVICE ever renders a given
// completion (key) — whether that's live, or because the app was closed and
// reopened after the finish — it auto-opens with full confetti + chime, and
// remembers it in localStorage so it won't keep auto-popping after that.
// A small chip stays in the page so it can always be reopened (with a fresh
// celebration replay) on request.
function useEndCard(active:boolean,key:string){
  const [open,setOpen]=useState(false);
  const [burst,setBurst]=useState(0);
  const lastKey=useRef<string|null>(null);

  useEffect(()=>{
    if(!active||!key){ lastKey.current=null; return; }
    if(lastKey.current===key)return; // already handled this key during this mount
    lastKey.current=key;
    let alreadySeen=false;
    try{ alreadySeen=!!localStorage.getItem(CELEBRATED_PREFIX+key); }catch{/* ignore */}
    if(!alreadySeen){
      try{ localStorage.setItem(CELEBRATED_PREFIX+key,"1"); }catch{/* ignore */}
      setOpen(true);
      setBurst(b=>b+1);
      playVictoryChime();
    }
  },[active,key]);

  const reopen=useCallback(()=>{ setOpen(true); setBurst(b=>b+1); playVictoryChime(); },[]);
  const dismiss=useCallback(()=>setOpen(false),[]);
  return {open,burst,reopen,dismiss};
}

// Runner-up / third-place strip shown under the champion name
function Podium({rows}:{rows:{label:string;name:string;sub?:string;color?:string}[]}){
  if(!rows.length)return null;
  return(
    <div className="flex flex-col gap-1 mt-1 w-full max-w-[220px]">
      {rows.map(r=>(
        <div key={r.label} className="flex items-center gap-2 bg-white/70 border border-[var(--ink)] rounded-[9px] px-2.5 py-1">
          <span className="font-[Fredoka] font-bold text-[11px] text-[var(--ink-soft)] w-9 flex-shrink-0">{r.label}</span>
          {r.color&&<span className="w-2.5 h-2.5 rounded-full flex-shrink-0 border border-[var(--ink)]" style={{background:r.color}}/>}
          <span className="font-[Fredoka] font-bold text-[12px] text-[var(--ink)] flex-1 min-w-0 truncate text-left">{r.name}</span>
          {r.sub&&<span className="font-[Nunito] font-bold text-[10px] text-[var(--muted)] flex-shrink-0">{r.sub}</span>}
        </div>
      ))}
    </div>
  );
}

// Centered popup, portaled to <body> so scroll position / page layout never affects it.
// The sunburst behind it is sized off the viewport (vmax, square) so it stays a true
// circle and fully covers the screen at any aspect ratio, not just inside the card.
function ChampionModal({open,onClose,burstKey,celebrate,kicker,name,detail,podiumRows,onUndo,readOnly}:{
  open:boolean;onClose:()=>void;burstKey:string;celebrate:boolean;
  kicker:string;name:string;detail:string;
  podiumRows:{label:string;name:string;sub?:string;color?:string}[];
  onUndo?:()=>void;readOnly?:boolean;
}){
  if(!open)return null;
  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 champion-backdrop" style={{background:"rgba(22,35,59,0.6)",backdropFilter:"blur(4px)"}}
        onClick={onClose} aria-hidden="true"/>
      <div className="victor-sunburst" aria-hidden="true"/>
      <div className="absolute inset-0 flex items-center justify-center p-4 pointer-events-none">
        <div className="champion-card-pop pointer-events-auto relative overflow-hidden w-full max-w-md rounded-2xl border-[3px] border-[var(--ink)] flex flex-col items-center justify-center gap-1 px-8 py-9 text-center"
          style={{background:"radial-gradient(130% 130% at 50% -10%,rgba(255,192,46,.7),rgba(255,192,46,0) 62%),var(--card2)",boxShadow:"0 10px 0 rgba(22,35,59,.22), 0 22px 50px rgba(22,35,59,.3)"}}>
          <button onClick={onClose} aria-label="Close" style={{touchAction:"manipulation"}}
            className="absolute top-3 right-3 w-8 h-8 rounded-[8px] border-2 border-[var(--ink)] bg-white text-[var(--ink)] font-bold text-lg grid place-items-center shadow-[0_2px_0_rgba(22,35,59,.22)] hover:bg-[#F5EFE0] active:translate-y-px transition-all cursor-pointer">✕</button>
          <span className="victor-stagger" style={{["--vd" as any]:"0s",fontSize:52,lineHeight:1,filter:"drop-shadow(0 4px 0 rgba(22,35,59,.18))",animation:"champBounce 1.8s ease-in-out .5s infinite"}}>🍻</span>
          <div className="victor-stagger" style={{["--vd" as any]:"0.12s"}}>
            <div className="font-[Fredoka] tracking-[3px] text-[11px] text-[var(--sun-deep)] font-bold uppercase mb-1">{kicker}</div>
          </div>
          <div className="victor-stagger" style={{["--vd" as any]:"0.24s"}}>
            <div className="victor-shine font-[Luckiest_Guy,cursive] text-[clamp(22px,4vw,34px)] leading-tight tracking-wide">{name}</div>
          </div>
          <div className="victor-stagger" style={{["--vd" as any]:"0.36s"}}>
            <div className="font-[Fredoka] font-semibold text-[13px] text-[var(--ink-soft)] mt-1">{detail}</div>
          </div>
          {podiumRows.length>0&&(
            <div className="victor-stagger" style={{["--vd" as any]:"0.48s"}}>
              <Podium rows={podiumRows}/>
            </div>
          )}
          {onUndo&&!readOnly&&(
            <button onClick={onUndo} style={{touchAction:"manipulation",["--vd" as any]:"0.6s"}}
              className="victor-stagger font-[Fredoka] font-semibold text-[12px] bg-white text-[var(--ink)] border-2 border-[var(--ink)] rounded-[9px] px-3 py-1.5 shadow-[0_2px_0_rgba(22,35,59,.22)] active:translate-y-px cursor-pointer mt-3">↺ Undo last heat</button>
          )}
        </div>
      </div>
      {celebrate&&<Confetti burstKey={burstKey}/>}
    </div>,
    document.body
  );
}

// Small persistent chip shown in the page once the champion modal has been seen/dismissed
function ChampionChip({label,onClick}:{label:string;onClick:()=>void}){
  return(
    <button onClick={onClick} style={{touchAction:"manipulation"}}
      className="w-full flex items-center justify-center gap-2 font-[Fredoka] font-bold text-[13px] text-[var(--ink)] bg-white border-[3px] border-[var(--ink)] rounded-2xl px-4 py-3 shadow-[0_4px_0_rgba(22,35,59,.18)] active:translate-y-px transition-all cursor-pointer">
      🏆 {label} <span className="text-[var(--muted)] font-semibold text-[11px]">— tap to view</span>
    </button>
  );
}

// ─── Grand Prix view ──────────────────────────────────────────────────────────
const POS_LABEL = ["1st","2nd","3rd","4th"];
const POS_COLOR = ["var(--sun)","#D8DEE9","#E8B98A","#EDE8DC"];

function GrandPrix({names,realCount,gpLog,target,readOnly,onRecord,onUndo}:{
  names:string[];realCount:number;gpLog:number[][];target:number;readOnly:boolean;
  onRecord:(order:number[])=>void;onUndo:()=>void;
}){
  const nameOf=(seed:number)=>names[seed]?.trim()||`Racer ${seed+1}`;
  const gpColors=useContext(ColorsCtx);
  const colorOf=(seed:number)=>gpColors[seed]||PALETTE[seed%PALETTE.length];
  const total=gpTotalRaces(realCount,target);
  const done=gpLog.length;
  const complete=gpComplete(realCount,target,gpLog);
  const standings=gpStandings(realCount,gpLog);
  const heat=complete?[]:gpNextHeat(realCount,gpLog);
  const celebKey=complete&&standings.length?`${standings[0].seed}|${done}`:"";
  const {open:champOpen,burst,reopen:reopenChamp,dismiss:dismissChamp}=useEndCard(complete,celebKey);

  // in-progress finishing order (local, host only)
  const [order,setOrder]=useState<number[]>([]);
  const [logOpen,setLogOpen]=useState(false);
  // reset the in-progress order whenever the heat changes (new race or undo)
  const heatKey=heat.join(",")+"|"+done;
  const [lastKey,setLastKey]=useState(heatKey);
  if(heatKey!==lastKey){ setLastKey(heatKey); if(order.length) setOrder([]); }

  const tap=(seed:number)=>{
    if(readOnly||order.includes(seed))return;
    let next=[...order,seed];
    // auto-place the final racer when only one remains
    const remaining=heat.filter(s=>!next.includes(s));
    if(remaining.length===1)next=[...next,remaining[0]];
    setOrder(next);
  };
  const placed=(seed:number)=>order.indexOf(seed);
  const ready=order.length===heat.length&&heat.length>0;

  const raceLog=done===0?null:(
    <div className="mt-5 border-t-2 border-dotted border-[#C9BFA8] pt-3">
      <button onClick={()=>setLogOpen(o=>!o)} style={{touchAction:"manipulation"}}
        className="w-full flex items-center justify-between font-[Fredoka] font-bold text-[13px] text-[var(--ink)] cursor-pointer py-1">
        <span>📜 Heat History <span className="text-[var(--muted)] font-semibold">({done})</span></span>
        <span className={`transition-transform ${logOpen?"rotate-90":""}`}>▸</span>
      </button>
      {logOpen&&(
        <div className="mt-2 flex flex-col gap-1.5">
          {gpLog.map((race,i)=>(
            <div key={i} className="flex items-center gap-2 bg-white border border-[var(--ink)] rounded-[8px] px-2.5 py-1.5 shadow-[0_1px_0_rgba(22,35,59,.1)]">
              <span className="font-[Fredoka] font-bold text-[9px] text-[var(--ink-soft)] w-10 flex-shrink-0">Heat {i+1}</span>
              <span className="font-[Nunito] text-[11.5px] font-bold text-[var(--ink)] flex-1 min-w-0 truncate">
                {race.map((seed,pos)=>(
                  <span key={pos}>
                    <span style={{color:pos===0?"var(--grass-deep)":"var(--ink-soft)"}}>{POS_LABEL[pos]} {nameOf(seed)}</span>
                    {pos<race.length-1?<span className="text-[var(--muted)]">{"  ·  "}</span>:null}
                  </span>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return(
    <section className="mt-5">
      <div className="flex items-center gap-3 mb-3">
        <span className="w-3 h-3 border-2 border-[var(--ink)] rotate-45 rounded-sm flex-shrink-0" style={{background:"var(--grape)"}}/>
        <span className="font-[Luckiest_Guy,cursive] text-[17px] tracking-wider text-white rounded-[9px] px-3 py-0.5 shadow-[0_3px_0_rgba(22,35,59,.22)] flex-shrink-0"
          style={{background:"var(--grape)",border:"2px solid var(--ink)",transform:"rotate(-1deg)"}}>Grand Prix</span>
        <span className="font-[Fredoka] font-bold text-[12px] text-[var(--ink-soft)] flex-shrink-0">Heat {Math.min(done+ (complete?0:1),total)} of {total}</span>
        <span className="h-[2px] bg-[var(--ink)] opacity-15 flex-1 rounded"/>
      </div>

      <div className="flex flex-wrap gap-5 items-start">
        {/* Current heat / champion */}
        <div className="flex-1 min-w-[280px]">
          {complete?(
            <>
              <ChampionChip label={`${nameOf(standings[0].seed)} won the Grand Prix`} onClick={reopenChamp}/>
              <ChampionModal
                open={champOpen} onClose={dismissChamp} burstKey={celebKey} celebrate={burst>0}
                kicker="🏆 Grand Prix Champion 🏆"
                name={nameOf(standings[0].seed)}
                detail={`${standings[0].points} pts over ${standings[0].races} heats`}
                podiumRows={standings.length>1?standings.slice(1,3).map((r,i)=>({
                  label:i===0?"🥈 2nd":"🥉 3rd",
                  name:nameOf(r.seed),
                  sub:`${r.points} pts`,
                  color:colorOf(r.seed),
                })):[]}
                onUndo={onUndo} readOnly={readOnly}
              />
            </>
          ):(
            <div className="rounded-2xl border-[3px] border-[var(--ink)] bg-white p-4 shadow-[0_4px_0_rgba(22,35,59,.14)]">
              <div className="flex items-center justify-between mb-3">
                <span className="font-[Fredoka] font-bold text-[14px] text-[var(--ink)]">🏁 Now Racing</span>
                <span className="font-[Nunito] font-bold text-[10.5px] text-[var(--muted)]">{readOnly?"Tap order on host screen":"Tap in finishing order"}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {heat.map(seed=>{
                  const p=placed(seed);
                  const assigned=p>=0;
                  return(
                    <button key={seed} disabled={readOnly||assigned} onClick={()=>tap(seed)} style={{touchAction:"manipulation",borderLeft:`6px solid ${colorOf(seed)}`}}
                      className={`relative flex items-center gap-2 px-3 py-3 rounded-[11px] border-2 border-[var(--ink)] text-left transition-all ${assigned?"":"bg-[#F7F2E6] hover:bg-[var(--sun)] cursor-pointer active:translate-y-px"} ${readOnly&&!assigned?"opacity-90 cursor-default":""}`}>
                      <span className="inline-grid place-items-center w-[22px] h-[22px] rounded-[5px] border border-[var(--ink)] text-[10px] font-bold flex-shrink-0"
                        style={{background:assigned?POS_COLOR[p]:"#fff",color:"var(--ink)"}}>{assigned?p+1:"·"}</span>
                      <span className="w-3.5 h-3.5 rounded-full flex-shrink-0 border-2 border-[var(--ink)]" style={{background:colorOf(seed)}}/>
                      <span className="font-[Fredoka] font-bold text-[13px] text-[var(--ink)] flex-1 min-w-0 truncate">{nameOf(seed)}</span>
                      {assigned&&<span className="font-[Nunito] font-bold text-[10px] text-[var(--muted)] flex-shrink-0">{POS_LABEL[p]} · +{gpPointsFor(p)}</span>}
                    </button>
                  );
                })}
              </div>
              {!readOnly&&(
                <div className="flex items-center gap-2 mt-3">
                  <button disabled={!ready} onClick={()=>{if(ready){onRecord(order);setOrder([]);}}} style={{touchAction:"manipulation"}}
                    className={`flex-1 font-[Fredoka] font-bold text-[13px] px-3 py-2.5 rounded-[10px] border-2 border-[var(--ink)] shadow-[0_3px_0_rgba(22,35,59,.22)] transition-all ${ready?"bg-[var(--grass)] text-white hover:brightness-105 active:translate-y-px cursor-pointer":"bg-[#E7E2D5] text-[var(--muted)] cursor-default"}`}>
                    {ready?"✔ Save heat result":`Tap ${heat.length-order.length} more`}
                  </button>
                  {order.length>0&&<button onClick={()=>setOrder([])} style={{touchAction:"manipulation"}}
                    className="font-[Fredoka] font-semibold text-[12px] bg-white text-[var(--ink)] border-2 border-[var(--ink)] rounded-[10px] px-3 py-2.5 shadow-[0_2px_0_rgba(22,35,59,.22)] active:translate-y-px cursor-pointer">Clear</button>}
                  {done>0&&<button onClick={onUndo} title="Undo last saved heat" style={{touchAction:"manipulation"}}
                    className="font-[Fredoka] font-semibold text-[12px] bg-white text-[var(--ink)] border-2 border-[var(--ink)] rounded-[10px] px-3 py-2.5 shadow-[0_2px_0_rgba(22,35,59,.22)] active:translate-y-px cursor-pointer">↺</button>}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Leaderboard */}
        <div className="flex-1 min-w-[260px]">
          <div className="font-[Fredoka] font-bold text-[12px] text-[var(--ink-soft)] mb-1.5 pb-1 border-b border-dotted border-[#C9BFA8]">🏆 Standings</div>
          <div className="flex flex-col gap-1.5">
            {standings.map(r=>{
              const leader=r.rank===1&&done>0;
              return(
                <div key={r.seed} style={{borderLeft:`6px solid ${colorOf(r.seed)}`}} className={`flex items-center gap-2 border-2 border-[var(--ink)] rounded-[9px] px-2.5 py-1.5 ${leader?"bg-[var(--sun)] shadow-[0_2px_0_rgba(22,35,59,.18)]":"bg-white"}`}>
                  <span className="font-[Luckiest_Guy,cursive] text-[14px] text-[var(--ink)] w-6 flex-shrink-0 text-center">{r.rank}</span>
                  <span className="w-3.5 h-3.5 rounded-full flex-shrink-0 border-2 border-[var(--ink)]" style={{background:colorOf(r.seed)}}/>
                  <span className="font-[Fredoka] font-bold text-[13px] text-[var(--ink)] flex-1 min-w-0 truncate">{nameOf(r.seed)}</span>
                  <span className="font-[Nunito] font-bold text-[10px] text-[var(--muted)] flex-shrink-0">{r.races} heats</span>
                  <span className="font-[Luckiest_Guy,cursive] text-[16px] text-[var(--ink)] flex-shrink-0 min-w-[26px] text-right">{r.points}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 font-[Nunito] text-[10.5px] font-semibold text-[var(--muted)] leading-snug">3 / 2 / 1 / 0 points for 1st through 4th. Most points after {total} heats wins.</p>
        </div>
      </div>

      {raceLog}
    </section>
  );
}


// ─── Final placements (bracket) ───────────────────────────────────────────────
// Full finishing order for a completed double-elim: champion, runner-up, then
// everyone else ranked by how deep in the Losers Bracket they were eliminated.
export interface PlacementRow { seed:number; name:string; place:number; }
export function bracketPlacements(M:Record<string,MatchResult>,names:string[]):PlacementRow[]{
  const isReal=(p:Competitor):p is Player=>p!==TBD&&p!==BYE;
  const champ=getChampion(M),runnerUp=getRunnerUp(M);
  if(!champ)return[];
  const rows:PlacementRow[]=[{seed:champ.seed,name:champ.name??`Racer ${champ.seed}`,place:1}];
  if(runnerUp)rows.push({seed:runnerUp.seed,name:runnerUp.name??`Racer ${runnerUp.seed}`,place:2});
  const placed=new Set(rows.map(r=>r.seed));
  // Everyone else: find the LB round where they took their final loss.
  const elim:{seed:number;name:string;round:number}[]=[];
  for(const id in M){
    const m=M[id];
    if(!m.active||!m.decided||m.auto||m.phantom)continue;
    if(m.def.bracket!=="lb")continue;
    if(!isReal(m.loser))continue;
    if(placed.has(m.loser.seed))continue;
    const g=/^L(\d+)/.exec(m.def.grp);
    elim.push({seed:m.loser.seed,name:m.loser.name??`Racer ${m.loser.seed}`,round:g?+g[1]:0});
  }
  elim.sort((a,b)=>b.round-a.round||a.seed-b.seed);
  let place=3,i=0;
  while(i<elim.length){
    const r=elim[i].round;
    const group=elim.filter(e=>e.round===r);
    for(const e of group)rows.push({seed:e.seed,name:e.name,place});
    place+=group.length;i+=group.length;
  }
  return rows;
}
const ord=(n:number)=>n===1?"1st":n===2?"2nd":n===3?"3rd":`${n}th`;

// ─── Results card (shareable JPG) ─────────────────────────────────────────────
function drawRecap(opts:{mode:Mode;rows:{place:string;name:string;color:string;stat?:string}[];heats:number}):HTMLCanvasElement{
  const {mode,rows,heats}=opts;
  const scale=2,W=760,ROW=56,PAD=34,HEAD=180,FOOT=64;
  const H=HEAD+rows.length*ROW+FOOT+PAD;
  const cv=document.createElement("canvas");cv.width=W*scale;cv.height=H*scale;
  const ctx=cv.getContext("2d");if(!ctx)return cv;
  ctx.scale(scale,scale);
  // background + header band
  ctx.fillStyle="#FBF6EA";ctx.fillRect(0,0,W,H);
  ctx.fillStyle="#FFC02E";ctx.fillRect(0,0,W,108);
  ctx.fillStyle="#16233B";ctx.fillRect(0,104,W,4);
  ctx.fillStyle="#16233B";
  ctx.font="bold 44px 'Luckiest Guy','Fredoka',system-ui,sans-serif";
  ctx.fillText("🍺 BEERIO KART",PAD,66);
  ctx.font="bold 17px 'Fredoka',system-ui,sans-serif";
  const d=new Date();
  const sub=`${mode==="gp"?"Grand Prix":"Double Elimination"} · ${d.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"})} · ${heats} heats`;
  ctx.fillText(sub,PAD,94);
  // champion callout
  const champ=rows[0];
  if(champ){
    ctx.font="bold 15px 'Fredoka',system-ui,sans-serif";
    ctx.fillStyle="#8a6d00";ctx.fillText("CHAMPION",PAD,146);
    ctx.fillStyle=champ.color;
    ctx.beginPath();ctx.arc(PAD+11,168,11,0,7);ctx.fill();
    ctx.strokeStyle="#16233B";ctx.lineWidth=2;ctx.stroke();
    ctx.fillStyle="#16233B";
    ctx.font="bold 32px 'Fredoka',system-ui,sans-serif";
    ctx.fillText(`🏆 ${champ.name}`,PAD+32,178);
  }
  // standings rows
  let y=HEAD+26;
  ctx.font="bold 18px 'Fredoka',system-ui,sans-serif";
  rows.forEach((r,i)=>{
    const top=y-26+i*ROW;
    ctx.fillStyle=i===0?"#FFF3D1":"#FFFFFF";
    ctx.strokeStyle="#16233B";ctx.lineWidth=2;
    const rr=(x:number,ry:number,w:number,h:number,rad:number)=>{ctx.beginPath();ctx.moveTo(x+rad,ry);ctx.arcTo(x+w,ry,x+w,ry+h,rad);ctx.arcTo(x+w,ry+h,x,ry+h,rad);ctx.arcTo(x,ry+h,x,ry,rad);ctx.arcTo(x,ry,x+w,ry,rad);ctx.closePath();};
    rr(PAD,top,W-PAD*2,ROW-10,10);ctx.fill();ctx.stroke();
    ctx.fillStyle="#16233B";
    ctx.font="bold 17px 'Fredoka',system-ui,sans-serif";
    ctx.fillText(r.place,PAD+16,top+30);
    ctx.fillStyle=r.color;
    ctx.beginPath();ctx.arc(PAD+82,top+23,9,0,7);ctx.fill();
    ctx.strokeStyle="#16233B";ctx.lineWidth=1.6;ctx.stroke();
    ctx.fillStyle="#16233B";
    ctx.font="bold 19px 'Fredoka',system-ui,sans-serif";
    ctx.fillText(r.name.slice(0,22),PAD+102,top+30);
    if(r.stat){
      ctx.font="bold 15px 'Nunito',system-ui,sans-serif";
      ctx.fillStyle="#5A6478";
      const w=ctx.measureText(r.stat).width;
      ctx.fillText(r.stat,W-PAD-16-w,top+29);
    }
  });
  // footer
  ctx.fillStyle="#8B93A5";
  ctx.font="bold 13px 'Nunito',system-ui,sans-serif";
  ctx.fillText("Finish your drink before the line. 🍻",PAD,H-30);
  return cv;
}

function RecapModal({mode,rows,heats,onClose}:{mode:Mode;rows:{place:string;name:string;color:string;stat?:string}[];heats:number;onClose:()=>void}){
  const [url,setUrl]=useState<string>("");
  const blobRef=useRef<Blob|null>(null);
  const [msg,setMsg]=useState("");
  useEffect(()=>{
    const cv=drawRecap({mode,rows,heats});
    cv.toBlob(b=>{
      if(!b)return;
      blobRef.current=b;
      setUrl(URL.createObjectURL(b));
    },"image/jpeg",0.92);
    return()=>{setUrl(u=>{if(u)URL.revokeObjectURL(u);return"";});};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const fname=`beerio-kart-results-${new Date().toISOString().slice(0,10)}.jpg`;
  const share=async()=>{
    const b=blobRef.current;if(!b)return;
    const file=new File([b],fname,{type:"image/jpeg"});
    try{
      if(navigator.canShare&&navigator.canShare({files:[file]})){
        await navigator.share({files:[file],title:"Beerio Kart Results"});return;
      }
    }catch{/* user cancelled or unsupported */}
    setMsg("Sharing not available here, use Download instead.");
    setTimeout(()=>setMsg(""),2500);
  };
  return(
    <ModalShell onClose={onClose} title="📸 RESULTS CARD" subtitle="Share tonight's damage with the group chat.">
      <div className="px-5 py-4 flex flex-col items-center gap-3">
        {url?(
          <img src={url} alt="Tournament results" className="w-full max-w-[380px] border-[3px] border-[var(--ink)] rounded-[12px] shadow-[0_4px_0_rgba(22,35,59,.18)]"/>
        ):(
          <div className="py-10 font-[Fredoka] font-semibold text-[13px] text-[var(--muted)]">Building your results card…</div>
        )}
        <div className="flex gap-2 w-full max-w-[380px]">
          <button onClick={share} style={{touchAction:"manipulation"}}
            className="flex-1 font-[Fredoka] font-bold text-[13px] px-3 py-2.5 rounded-[10px] border-2 border-[var(--ink)] bg-[var(--grass)] text-white shadow-[0_3px_0_rgba(22,35,59,.22)] hover:brightness-105 active:translate-y-px transition-all cursor-pointer">📤 Share</button>
          <a href={url||undefined} download={fname}
            className="flex-1 text-center font-[Fredoka] font-bold text-[13px] px-3 py-2.5 rounded-[10px] border-2 border-[var(--ink)] bg-[var(--sun)] text-[var(--ink)] shadow-[0_3px_0_rgba(22,35,59,.22)] hover:bg-[var(--sun-deep)] active:translate-y-px transition-all cursor-pointer no-underline">⬇️ Download</a>
        </div>
        {msg&&<p className="font-[Nunito] text-[11px] font-bold text-[var(--coral)] m-0">{msg}</p>}
      </div>
    </ModalShell>
  );
}

// ─── Hall of Fame ─────────────────────────────────────────────────────────────
// Cross-night stats. Every completed tournament becomes one log entry carrying
// per-player stat deltas, so totals are always derivable and merging two
// devices' histories is a simple union by entry key. Stored server-side under a
// durable crew code (created lazily), with a local cache as offline fallback.
interface HofStat { t?:number; g?:number; w?:number; l?:number; p?:number; hw?:number; }
interface HofLogEntry { key:string; date:string; mode:Mode; champion:string; runnerUp?:string; stats:Record<string,HofStat>; }
interface HofData { log: HofLogEntry[]; }

function loadHofCache():HofData{
  try{const raw=localStorage.getItem(HOF_CACHE_KEY);if(raw){const o=JSON.parse(raw);if(o&&Array.isArray(o.log))return o as HofData;}}catch{/* ignore */}
  return {log:[]};
}
function saveHofCache(d:HofData){try{localStorage.setItem(HOF_CACHE_KEY,JSON.stringify(d));}catch{/* quota */}}
function mergeHof(a:HofData,b:HofData):HofData{
  const seen=new Set(a.log.map(e=>e.key));
  const log=[...a.log];
  for(const e of b.log)if(e&&e.key&&!seen.has(e.key)){log.push(e);seen.add(e.key);}
  log.sort((x,y)=>x.date<y.date?-1:1);
  return {log};
}
interface HofTotals { name:string; titles:number; gpTitles:number; wins:number; losses:number; points:number; heatWins:number; nights:number; }
function hofTotals(d:HofData):HofTotals[]{
  const map=new Map<string,HofTotals>();
  for(const e of d.log){
    for(const [name,s] of Object.entries(e.stats||{})){
      const row=map.get(name)||{name,titles:0,gpTitles:0,wins:0,losses:0,points:0,heatWins:0,nights:0};
      row.titles+=s.t||0;row.gpTitles+=s.g||0;row.wins+=s.w||0;row.losses+=s.l||0;
      row.points+=s.p||0;row.heatWins+=s.hw||0;row.nights++;
      map.set(name,row);
    }
  }
  return [...map.values()].sort((a,b)=>(b.titles+b.gpTitles)-(a.titles+a.gpTitles)||b.wins-a.wins||b.points-a.points||a.name.localeCompare(b.name));
}
function getHofCode():string|null{try{return localStorage.getItem(HOF_CODE_KEY);}catch{return null;}}
function setHofCode(c:string){try{localStorage.setItem(HOF_CODE_KEY,c);}catch{/* ignore */}}

// Push local history to the server (create the crew on first use), pull anything
// another device recorded, and keep the merged result as the new local cache.
async function syncHof():Promise<HofData>{
  const local=loadHofCache();
  try{
    let code=getHofCode();
    if(!code){
      const r=await fetch(`${API}/hof`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({data:local})});
      if(!r.ok)throw new Error();
      const j=await r.json();code=j.code;if(code)setHofCode(code);
      return local;
    }
    const g=await fetch(`${API}/hof/${code}`);
    if(g.status===404){
      await fetch(`${API}/hof/${code}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({data:local})});
      return local;
    }
    if(!g.ok)throw new Error();
    const j=await g.json();
    const server:HofData=(j?.data&&Array.isArray(j.data.log))?j.data as HofData:{log:[]};
    const merged=mergeHof(server,local);
    saveHofCache(merged);
    if(merged.log.length>server.log.length){
      await fetch(`${API}/hof/${code}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({data:merged})});
    }
    return merged;
  }catch{
    return local; // offline: local cache is the source of truth until next sync
  }
}
function recordHofEntry(entry:HofLogEntry):Promise<void>{
  const cache=loadHofCache();
  if(cache.log.some(e=>e.key===entry.key))return Promise.resolve();
  const next=mergeHof(cache,{log:[entry]});
  saveHofCache(next);
  return syncHof().then(()=>{});
}

function HofModal({onClose,viewCode}:{onClose:()=>void;viewCode?:string|null}){
  // viewCode !== undefined → spectator: read-only view of the host's crew, never
  // touches this device's own crew code or local cache.
  const readOnly=viewCode!==undefined;
  const [data,setData]=useState<HofData>(()=>readOnly?{log:[]}:loadHofCache());
  const [code,setCode]=useState<string|null>(()=>readOnly?(viewCode||null):getHofCode());
  const [linkVal,setLinkVal]=useState("");
  const [linkMsg,setLinkMsg]=useState("");
  useEffect(()=>{
    let on=true;
    if(readOnly){
      if(!viewCode)return;
      fetch(`${API}/hof/${viewCode}`)
        .then(r=>r.ok?r.json():null)
        .then(j=>{if(on&&j?.data&&Array.isArray(j.data.log))setData(j.data as HofData);})
        .catch(()=>{/* transient */});
      return()=>{on=false;};
    }
    syncHof().then(d=>{if(on){setData(d);setCode(getHofCode());}});
    return()=>{on=false;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const totals=hofTotals(data);
  const recent=[...data.log].reverse().slice(0,8);
  const link=async()=>{
    const c=linkVal.trim().toUpperCase();
    if(!/^[A-Z2-9]{4,12}$/.test(c)){setLinkMsg("That doesn't look like a crew code.");return;}
    try{
      const r=await fetch(`${API}/hof/${c}`);
      if(!r.ok){setLinkMsg("Crew not found.");return;}
      const j=await r.json();
      const server:HofData=(j?.data&&Array.isArray(j.data.log))?j.data as HofData:{log:[]};
      setHofCode(c);setCode(c);
      const merged=mergeHof(server,loadHofCache());
      saveHofCache(merged);setData(merged);setLinkVal("");setLinkMsg("Linked! History merged.");
      void syncHof();
    }catch{setLinkMsg("Couldn't reach the server.");}
    setTimeout(()=>setLinkMsg(""),2500);
  };
  return(
    <ModalShell onClose={onClose} title="🏆 HALL OF FAME" subtitle="All-time bragging rights, every game night counts.">
      <div className="px-5 py-4 flex flex-col gap-4">
        {totals.length===0?(
          <div className="py-8 text-center">
            <span className="text-3xl block mb-2">🍺</span>
            <p className="font-[Nunito] font-semibold text-[12.5px] text-[var(--muted)] m-0 leading-relaxed">{readOnly?"No nights on the books for this crew yet. Check back after tonight's tournament wraps.":"No tournaments recorded yet. Finish a bracket or Grand Prix and the winner gets etched in here forever."}</p>
          </div>
        ):(
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-[24px_1fr_44px_64px_52px] gap-1 px-2 font-[Fredoka] font-bold text-[9.5px] text-[var(--muted)] uppercase tracking-wider">
              <span/><span>Racer</span><span className="text-center">🏆</span><span className="text-center">W–L</span><span className="text-center">GP pts</span>
            </div>
            {totals.map((r,i)=>(
              <div key={r.name} className={`grid grid-cols-[24px_1fr_44px_64px_52px] gap-1 items-center border-2 border-[var(--ink)] rounded-[9px] px-2 py-1.5 ${i===0?"bg-[var(--sun)]":"bg-white"}`}>
                <span className="font-[Luckiest_Guy,cursive] text-[13px] text-[var(--ink)] text-center">{i+1}</span>
                <span className="font-[Fredoka] font-bold text-[13px] text-[var(--ink)] truncate">{r.name}</span>
                <span className="font-[Fredoka] font-bold text-[13px] text-[var(--ink)] text-center">{r.titles+r.gpTitles}</span>
                <span className="font-[Nunito] font-bold text-[11.5px] text-[var(--ink-soft)] text-center">{r.wins}–{r.losses}</span>
                <span className="font-[Nunito] font-bold text-[11.5px] text-[var(--ink-soft)] text-center">{r.points}</span>
              </div>
            ))}
          </div>
        )}
        {recent.length>0&&(
          <div>
            <div className="font-[Fredoka] font-bold text-[12px] text-[var(--ink-soft)] mb-1.5 pb-1 border-b border-dotted border-[#C9BFA8]">📜 Recent nights</div>
            <div className="flex flex-col gap-1">
              {recent.map(e=>(
                <div key={e.key} className="flex items-center gap-2 bg-white border border-[var(--ink)] rounded-[8px] px-2.5 py-1.5">
                  <span className="font-[Fredoka] font-bold text-[9.5px] text-[var(--ink)] bg-[#F5EFE0] border border-[var(--ink)] rounded-[3px] px-1.5 py-px leading-none flex-shrink-0">{e.mode==="gp"?"GP":"Bracket"}</span>
                  <span className="font-[Nunito] text-[12px] font-bold text-[var(--ink)] flex-1 min-w-0 truncate">🏆 {e.champion}{e.runnerUp?<span className="text-[var(--muted)] font-semibold"> over {e.runnerUp}</span>:null}</span>
                  <span className="font-[Nunito] font-bold text-[10px] text-[var(--muted)] flex-shrink-0">{new Date(e.date).toLocaleDateString(undefined,{month:"short",day:"numeric"})}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {readOnly?(
          <div className="border-t-2 border-dotted border-[#C9BFA8] pt-3">
            <p className="font-[Nunito] text-[10.5px] font-semibold text-[var(--muted)] leading-snug m-0">
              {code?<>Crew code <span className="font-bold text-[var(--ink)] bg-[var(--card2)] border border-[var(--ink)] rounded px-1.5 py-px">{code}</span> · enter it in the Hall of Fame on your own device to carry this crew's history with you.</>:"The host hasn't recorded a tournament yet, so there's no crew code to show."}
            </p>
          </div>
        ):(
        <div className="border-t-2 border-dotted border-[#C9BFA8] pt-3">
          <div className="font-[Fredoka] font-bold text-[11.5px] text-[var(--ink-soft)] mb-1">Crew code {code?<span className="font-[Nunito] text-[var(--ink)] bg-[var(--card2)] border border-[var(--ink)] rounded px-1.5 py-px ml-1">{code}</span>:<span className="text-[var(--muted)] font-semibold">(created after your first recorded night)</span>}</div>
          <p className="font-[Nunito] text-[10.5px] font-semibold text-[var(--muted)] leading-snug mt-0 mb-2">History lives on the server under this code. Enter it on another device to share one Hall of Fame.</p>
          <div className="flex gap-2">
            <input value={linkVal} onChange={e=>setLinkVal(e.target.value)} placeholder="Enter a crew code" maxLength={12} autoComplete="off"
              className="flex-1 min-w-0 px-2.5 py-2 bg-white border-2 border-[var(--ink)] rounded-[9px] font-[Nunito] text-[12px] font-bold text-[var(--ink)] outline-none uppercase placeholder:normal-case placeholder:text-[#A9B2C2]"/>
            <button onClick={link} style={{touchAction:"manipulation"}}
              className="flex-shrink-0 px-3 py-2 rounded-[9px] border-2 border-[var(--ink)] bg-[var(--sun)] hover:bg-[var(--sun-deep)] font-[Fredoka] font-semibold text-[12px] text-[var(--ink)] shadow-[0_2px_0_rgba(22,35,59,.22)] active:translate-y-px transition-all cursor-pointer">Link</button>
          </div>
          {linkMsg&&<p className="font-[Nunito] text-[11px] font-bold text-[var(--ink-soft)] mt-1.5 m-0">{linkMsg}</p>}
        </div>
        )}
      </div>
    </ModalShell>
  );
}

// ─── Spectator predictions ────────────────────────────────────────────────────
// The heart of the live spectator view: call the next winner before it happens,
// see how the crowd leans, and climb the prediction leaderboard as results land.
interface PredEntry { name:string; picks:Record<string,string>; }
type PredMap = Record<string,PredEntry>;

function getSid():string{
  try{
    let s=localStorage.getItem(SID_KEY);
    if(!s){s="s"+Math.random().toString(36).slice(2,10)+Date.now().toString(36);localStorage.setItem(SID_KEY,s);}
    return s;
  }catch{return "s-anon";}
}
interface PredictableItem { key:string; label:string; options:{v:string;name:string;color:string}[]; }

function Predictions({canPick,preds,myName,onName,myPicks,onPick,items,scoreOf,defaultOpen}:{
  canPick:boolean;preds:PredMap;myName:string;onName:(n:string)=>void;
  myPicks:Record<string,string>;onPick:(key:string,v:string)=>void;
  items:PredictableItem[];
  scoreOf:(picks:Record<string,string>)=>{correct:number;total:number};
  defaultOpen:boolean;
}){
  const [open,setOpen]=useState(defaultOpen);
  const [nameDraft,setNameDraft]=useState(myName);
  const sid=getSid();
  const board=Object.entries(preds)
    .map(([id,e])=>({id,name:(e?.name||"").trim()||"Mystery fan",...scoreOf(e?.picks||{})}))
    .filter(r=>r.total>0||r.id===sid)
    .sort((a,b)=>b.correct-a.correct||a.total-b.total||a.name.localeCompare(b.name));
  const tally=(key:string)=>{
    const t:Record<string,number>={};let n=0;
    for(const e of Object.values(preds)){const v=e?.picks?.[key];if(v!==undefined){t[v]=(t[v]||0)+1;n++;}}
    return {t,n};
  };
  const named=!!myName.trim();
  return(
    <section className="max-w-[1360px] mx-auto px-4 mt-4">
      <div className="rounded-2xl border-[3px] border-[var(--ink)] bg-[#F3EEFF] shadow-[0_4px_0_rgba(22,35,59,.14)] overflow-hidden">
        <button onClick={()=>setOpen(o=>!o)} style={{touchAction:"manipulation"}}
          className="w-full flex items-center justify-between px-4 py-2.5 cursor-pointer bg-[var(--grape)] text-white">
          <span className="font-[Luckiest_Guy,cursive] text-[15px] tracking-wider">🔮 CROWD PREDICTIONS</span>
          <span className="flex items-center gap-2 font-[Fredoka] font-bold text-[11px]">
            {Object.keys(preds).length>0&&<span>{Object.keys(preds).length} predicting</span>}
            <span className={`transition-transform ${open?"rotate-90":""}`}>▸</span>
          </span>
        </button>
        {open&&(
          <div className="px-4 py-3 flex flex-wrap gap-5 items-start">
            <div className="flex-1 min-w-[270px]">
              {canPick&&!named&&(
                <div className="mb-3 flex gap-2 items-center">
                  <input value={nameDraft} onChange={e=>setNameDraft(e.target.value)} placeholder="Your name to start predicting" maxLength={18} autoComplete="off"
                    className="flex-1 min-w-0 px-2.5 py-2 bg-white border-2 border-[var(--ink)] rounded-[9px] font-[Nunito] text-[12.5px] font-bold text-[var(--ink)] outline-none placeholder:text-[#A9B2C2]"/>
                  <button onClick={()=>{const n=nameDraft.trim();if(n)onName(n);}} style={{touchAction:"manipulation"}}
                    className="flex-shrink-0 px-3 py-2 rounded-[9px] border-2 border-[var(--ink)] bg-[var(--sun)] font-[Fredoka] font-semibold text-[12px] text-[var(--ink)] shadow-[0_2px_0_rgba(22,35,59,.22)] active:translate-y-px cursor-pointer">Join</button>
                </div>
              )}
              {items.length===0?(
                <p className="font-[Nunito] font-semibold text-[12px] text-[var(--muted)] m-0 py-2">Nothing to call right now, waiting on the next matchup…</p>
              ):(
                <div className="flex flex-col gap-2.5">
                  {items.map(it=>{
                    const {t,n}=tally(it.key);
                    const mine=myPicks[it.key];
                    return(
                      <div key={it.key} className="bg-white border-2 border-[var(--ink)] rounded-[11px] p-2.5">
                        <div className="font-[Fredoka] font-bold text-[10.5px] text-[var(--muted)] uppercase tracking-wide mb-1.5">{it.label}</div>
                        <div className={`grid gap-1.5 ${it.options.length>2?"grid-cols-2":"grid-cols-2"}`}>
                          {it.options.map(o=>{
                            const picked=mine===o.v;
                            const pct=n>0?Math.round(((t[o.v]||0)/n)*100):0;
                            return(
                              <button key={o.v} disabled={!canPick||!named} onClick={()=>canPick&&named&&onPick(it.key,o.v)}
                                style={{touchAction:"manipulation",...(picked?{background:o.color}:{})}}
                                className={`relative overflow-hidden text-left px-2.5 py-2 rounded-[9px] border-2 border-[var(--ink)] transition-all ${picked?"shadow-[0_2px_0_rgba(22,35,59,.22)]":"bg-[#FBF8F0]"} ${canPick&&named?"cursor-pointer hover:brightness-[1.03] active:translate-y-px":"cursor-default"}`}>
                                <span className="absolute left-0 top-0 bottom-0 pointer-events-none" style={{width:`${pct}%`,background:picked?"rgba(255,255,255,0.28)":o.color,opacity:picked?1:0.25,transition:"width .4s ease"}}/>
                                <span className="relative flex items-center gap-1.5">
                                  <span className="w-3 h-3 rounded-full flex-shrink-0 border-2 border-[var(--ink)]" style={{background:o.color}}/>
                                  <span className={`font-[Fredoka] font-bold text-[12px] flex-1 min-w-0 truncate`} style={{color:picked?textOn(o.color):"var(--ink)"}}>{o.name}</span>
                                  {n>0&&<span className="font-[Nunito] font-bold text-[10px] flex-shrink-0" style={{color:picked?textOn(o.color):"var(--ink-soft)"}}>{pct}%</span>}
                                  {picked&&<span className="text-[10px] flex-shrink-0" style={{color:textOn(o.color)}}>✔</span>}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {canPick&&named&&items.length>0&&<p className="font-[Nunito] text-[10.5px] font-semibold text-[var(--muted)] mt-2 mb-0 leading-snug">Tap to call the winner, tap your pick again to clear it. Picks lock the moment the result is recorded.</p>}
            </div>
            <div className="flex-1 min-w-[220px]">
              <div className="font-[Fredoka] font-bold text-[12px] text-[var(--ink-soft)] mb-1.5 pb-1 border-b border-dotted border-[#C9BFA8]">🎯 Prediction leaderboard</div>
              {board.length===0?(
                <p className="font-[Nunito] font-semibold text-[11.5px] text-[var(--muted)] m-0 py-1">No calls yet. Scan in, pick winners, talk trash.</p>
              ):(
                <div className="flex flex-col gap-1.5">
                  {board.map((r,i)=>(
                    <div key={r.id} className={`flex items-center gap-2 border-2 border-[var(--ink)] rounded-[9px] px-2.5 py-1.5 ${i===0&&r.correct>0?"bg-[var(--sun)]":"bg-white"} ${r.id===sid?"outline outline-2 outline-[var(--grape)] outline-offset-1":""}`}>
                      <span className="font-[Luckiest_Guy,cursive] text-[13px] text-[var(--ink)] w-5 flex-shrink-0 text-center">{i+1}</span>
                      <span className="font-[Fredoka] font-bold text-[12.5px] text-[var(--ink)] flex-1 min-w-0 truncate">{r.name}{r.id===sid?" (you)":""}</span>
                      <span className="font-[Nunito] font-bold text-[11px] text-[var(--ink-soft)] flex-shrink-0">{r.correct}/{r.total} right</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

// ─── Spectator state encode / decode ──────────────────────────────────────────
function encodeShare(s:SavedState):string{ return compressToEncodedURIComponent(JSON.stringify(s)); }
function buildShareURL(s:SavedState):string{
  const base=(typeof location!=="undefined")?location.origin+location.pathname:"";
  return `${base}#v=${encodeShare(s)}`;
}
function readSpectator():SavedState|null{
  if(typeof location==="undefined")return null;
  const m=(location.hash||"").match(/[#&]v=([^&]+)/);
  if(!m)return null;
  try{
    const raw=decompressFromEncodedURIComponent(m[1]);
    if(!raw)return null;
    const obj=JSON.parse(raw);
    if(obj&&Array.isArray(obj.names)&&typeof obj.playerCount==="number")return obj as SavedState;
  }catch{/* malformed */}
  return null;
}
function loadSaved():SavedState|null{
  if(typeof localStorage==="undefined")return null;
  try{const raw=localStorage.getItem(STORAGE_KEY);if(raw){const o=JSON.parse(raw);if(o&&Array.isArray(o.names))return o as SavedState;}}catch{/* ignore */}
  return null;
}

// ─── App ─────────────────────────────────────────────────────────────────────
export default function App(){
  const spectatorInit=useMemo(()=>readSpectator(),[]);
  const liveCode=useMemo(()=>(typeof location!=="undefined")?new URLSearchParams(location.search).get("s"):null,[]);
  const isLive=!!liveCode;
  const isSpectator=!!spectatorInit||isLive;
  const initial=useMemo<SavedState>(()=>{
    const base=spectatorInit ?? (isSpectator?null:loadSaved());
    if(base)return {
      playerCount:base.playerCount,
      names:base.names.slice(0,base.playerCount).concat(Array(Math.max(0,base.playerCount-base.names.length)).fill("")),
      results:base.results||{},
      series:base.series||{},
      format:{...DEFAULT_FORMAT,...(base.format||{})},
      gpLog:Array.isArray(base.gpLog)?base.gpLog:[],
      colors:normalizeColors(base.colors,base.playerCount),
      seeded:base.seeded!==false,
    };
    return {playerCount:DEFAULT_COUNT,names:Array(DEFAULT_COUNT).fill(""),results:{},series:{},format:DEFAULT_FORMAT,gpLog:[],colors:shuffledColors(DEFAULT_COUNT),seeded:true};
  },[spectatorInit,isSpectator]);

  const [playerCount,setPlayerCount]=useState(initial.playerCount);
  const [names,setNames]=useState<string[]>(initial.names);
  const [results,setResults]=useState<Record<string,"A"|"B">>(initial.results);
  const [series,setSeries]=useState<Series>(initial.series);
  const [format,setFormat]=useState<Format>(initial.format);
  const [gpLog,setGpLog]=useState<number[][]>(initial.gpLog);
  const [colors,setColors]=useState<string[]>(initial.colors??shuffledColors(initial.playerCount));
  const [seeded,setSeeded]=useState<boolean>(initial.seeded!==false);
  const [BR,setBR]=useState<Bracket>(()=>buildBracket(initial.playerCount));
  const [rulesOpen,setRulesOpen]=useState(false);
  const [statsNotice,setStatsNotice]=useState<string|null>(null);
  useEffect(()=>{gnStatsNotice=(m)=>setStatsNotice(m);return()=>{gnStatsNotice=null;};},[]);
  // GameNight event binding. Three jobs, in one place:
  //   host  + no room  -> prefill from the yes-RSVPs and open the room
  //   host  + room     -> rejoin that room (pull its state, don't clobber it)
  //   member           -> bounce into the host's room as a live spectator
  // Members used to land on their own local setup screen, so every person
  // who tapped Beerio Kart started a private tournament. The room now
  // belongs to the event, not to whoever's phone opened it first.
  // A member landing on ?event= has to resolve (are they the host? which room?)
  // via one network round trip before anything real can render. Until then, show
  // a neutral connecting card instead of the host's setup default, which is the
  // screen that used to flash past on the way into the live spectator view.
  // Gated so it never covers a night already in progress on this device (rule 8).
  const [gnResolving,setGnResolving]=useState(()=>!!gnEvent()&&!isLive&&!spectatorInit&&!loadSaved());
  const [gnWaiting,setGnWaiting]=useState(false);
  // Waiting members poll for the room; when the host opens it, they drop
  // straight into the live view without touching anything.
  useEffect(()=>{
    if(!gnWaiting)return;
    const ev=gnEvent();
    if(!ev)return;
    const t=setInterval(()=>{
      fetch(`${API}/beerio-context/${ev}`,{credentials:"same-origin"})
        .then(r=>r.ok?r.json():null)
        .then(d=>{if(d?.sessionCode)gnRedirect(`/beerio?s=${d.sessionCode}`);})
        .catch(()=>{/* keep waiting */});
    },4000);
    return()=>clearInterval(t);
  },[gnWaiting]);
  useEffect(()=>{
    const ev=gnEvent();
    if(!ev||isSpectator)return;
    let cancelled=false;

    fetch(`${API}/beerio-context/${ev}`,{credentials:"same-origin"})
      .then(r=>r.ok?r.json():null)
      .then(async d=>{
        if(cancelled)return;
        if(!d){setGnResolving(false);return;}

        // Not a host: watch the host's room, or wait for it to open.
        if(!d.canHost){
          if(d.sessionCode)gnRedirect(`/beerio?s=${d.sessionCode}`);
          else {setGnResolving(false);setGnWaiting(true);}
          return;
        }

        // From here down we're the host: setup or a rejoined room will render,
        // so drop the connecting gate.
        setGnResolving(false);

        // Host rejoining an open room: adopt its state so the auto-sync
        // effect can't overwrite the live night with this device's stale copy.
        if(d.sessionCode){
          try{
            const r=await fetch(`${API}/sessions/${d.sessionCode}`);
            if(r.ok&&!cancelled){
              const {state}=await r.json();
              if(state){
                setPlayerCount(state.playerCount);
                setNames(state.names??[]);
                setResults(state.results??{});
                setSeries(state.series??{});
                setFormat(state.format??DEFAULT_FORMAT);
                setGpLog(state.gpLog??[]);
                setColors(state.colors??shuffledColors(state.playerCount));
                setSeeded(!!state.seeded);
                setBR(buildBracket(state.playerCount));
              }
            }
          }catch{/* room unreachable: fall through with local state */}
          if(cancelled)return;
          setSessionCode(d.sessionCode);
          try{localStorage.setItem(SESSION_KEY,d.sessionCode);}catch{/* ignore */}
          setLiveStatus("live");
          return;
        }

        // Host, no room yet: prefill the roster from the yes-RSVPs, but
        // never over a night already in progress.
        const untouched=names.every(n=>!n||!n.trim())&&Object.keys(results).length===0&&gpLog.length===0;
        let sameEvent=false;
        try{sameEvent=localStorage.getItem("gamenight-beerio-event-v1")===ev;}catch{/* prefill */}
        if(sameEvent&&!untouched)return;
        if(!Array.isArray(d.prefill)||d.prefill.length<2)return;
        try{localStorage.setItem("gamenight-beerio-event-v1",ev);}catch{/* prefill anyway */}
        const n=Math.min(Math.max(d.prefill.length,2),12);
        setPlayerCount(n);
        setNames(()=>{const a=d.prefill.slice(0,n).map((x:string)=>String(x).slice(0,24));while(a.length<n)a.push("");return a;});
        setResults({});setSeries({});setGpLog([]);
        setColors(shuffledColors(n));
        setBR(buildBracket(n));
        setSessionCode(null);
        try{localStorage.removeItem(SESSION_KEY);}catch{/* ignore */}
      })
      .catch(()=>{setGnResolving(false);/* offline or logged out: setup screen stays as-is */});

    return()=>{cancelled=true;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[isSpectator]);
  const [formatOpen,setFormatOpen]=useState(false);
  const [shareOpen,setShareOpen]=useState(false);
  const [hofOpen,setHofOpen]=useState(false);
  // Host: own crew code (created after the first recorded night). Spectator: the
  // host's crew code, delivered inside the live/snapshot state.
  const [crew,setCrew]=useState<string|null>(()=>{
    if(spectatorInit&&typeof spectatorInit.hofCode==="string")return spectatorInit.hofCode;
    return isSpectator?null:getHofCode();
  });
  const [recapOpen,setRecapOpen]=useState(false);
  const [pickerFor,setPickerFor]=useState<number|null>(null);
  // spectator predictions
  const [preds,setPreds]=useState<PredMap>({});
  const [myPicks,setMyPicks]=useState<Record<string,string>>({});
  const [specName,setSpecName]=useState<string>(()=>{try{return localStorage.getItem(SPEC_NAME_KEY)||"";}catch{return "";}});
  const [sessionCode,setSessionCode]=useState<string|null>(()=>{
    if(isLive||typeof localStorage==="undefined")return null;
    try{return localStorage.getItem(SESSION_KEY)||null;}catch{return null;}
  });
  const [liveStatus,setLiveStatus]=useState<LiveStatus>(isLive?"connecting":"idle");

  // Persist (host only — never overwrite saved state while viewing a shared snapshot)
  useEffect(()=>{
    if(isSpectator||typeof localStorage==="undefined")return;
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify({playerCount,names,results,series,format,gpLog,colors,seeded}));}catch{/* quota */}
  },[isSpectator,playerCount,names,results,series,format,gpLog,colors,seeded]);

  // Host: push state to the live room (debounced) whenever it changes
  useEffect(()=>{
    if(isSpectator||!sessionCode)return;
    const t=setTimeout(()=>{
      fetch(`${API}/sessions/${sessionCode}`,{method:"PUT",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({state:{playerCount,names,results,series,format,gpLog,colors,seeded,hofCode:crew||undefined}})})
        .then(r=>{if(!r.ok)throw new Error();setLiveStatus("live");})
        .catch(()=>setLiveStatus("error"));
    },600);
    return ()=>clearTimeout(t);
  },[isSpectator,sessionCode,playerCount,names,results,series,format,gpLog,colors,seeded,crew]);

  // Spectator: poll the live room every few seconds and mirror its state
  useEffect(()=>{
    if(!liveCode)return;
    let active=true;
    const apply=(s:Partial<SavedState>|undefined)=>{
      if(!active||!s)return;
      const pc=Math.max(MIN_PLAYERS,Math.min(MAX_PLAYERS,Number(s.playerCount)||DEFAULT_COUNT));
      setPlayerCount(pc);
      setNames(()=>{const a=Array.isArray(s.names)?[...s.names].slice(0,pc):[];while(a.length<pc)a.push("");return a;});
      setResults(s.results||{});
      setSeries(s.series||{});
      setFormat({...DEFAULT_FORMAT,...(s.format||{})});
      setGpLog(Array.isArray(s.gpLog)?s.gpLog:[]);
      setColors(normalizeColors(s.colors,pc));
      setSeeded(s.seeded!==false);
      setCrew(typeof s.hofCode==="string"&&s.hofCode?s.hofCode:null);
      setBR(buildBracket(pc));
    };
    const tick=async()=>{
      try{
        const r=await fetch(`${API}/sessions/${liveCode}`);
        if(r.ok){const d=await r.json();apply(d.state);setLiveStatus("live");}
        else setLiveStatus("error");
      }catch{setLiveStatus("error");}
    };
    tick();
    const id=setInterval(tick,3000);
    return ()=>{active=false;clearInterval(id);};
  },[liveCode]);

  // Host: open a live room (create on first share, reuse the saved code after)
  const startLive=useCallback(async ()=>{
    setLiveStatus("connecting");
    const payload=JSON.stringify({state:{playerCount,names,results,series,format,gpLog,colors,seeded,hofCode:crew||undefined}});
    try{
      if(sessionCode){
        const r=await fetch(`${API}/sessions/${sessionCode}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:payload});
        if(!r.ok)throw new Error();
        setLiveStatus("live");return;
      }
      const r=await fetch(`${API}/sessions`,{method:"POST",headers:{"Content-Type":"application/json"},body:payload});
      if(!r.ok)throw new Error();
      const {code}=await r.json();
      setSessionCode(code);
      try{localStorage.setItem(SESSION_KEY,code);}catch{/* ignore */}
      // Bind the room to the event: this is what lets the rest of the crew
      // watch this night instead of starting their own.
      const ev=gnEvent();
      if(ev){
        fetch(`${API}/events/${ev}/beerio-session`,{
          method:"POST",headers:{"Content-Type":"application/json"},
          credentials:"same-origin",body:JSON.stringify({code}),
        }).catch(()=>{/* the room still works; members just can't auto-join */});
      }
      setLiveStatus("live");
    }catch{setLiveStatus("error");}
  },[sessionCode,playerCount,names,results,series,format,gpLog,colors,seeded,crew]);

  const handleSetCount=useCallback((n:number)=>{
    const next=Math.max(MIN_PLAYERS,Math.min(MAX_PLAYERS,n));
    if(next===playerCount)return;
    setPlayerCount(next);
    setNames(prev=>{const a=[...prev];while(a.length<next)a.push("");return a.slice(0,next);});
    setColors(prev=>normalizeColors(prev.slice(0,next),next));
    setResults({});setSeries({});setGpLog([]);setBR(buildBracket(next));
  },[playerCount]);

  const handleNameChange=useCallback((i:number,val:string)=>{
    setNames(prev=>{const a=[...prev];a[i]=val;return a;});
  },[]);

  const handleShuffle=useCallback(()=>{
    // Shuffle name+color together so a racer's kart color follows them to their new seed.
    const pairs=names.map((n,i)=>({name:n.trim(),color:colors[i]||PALETTE[i%PALETTE.length]})).filter(p=>p.name);
    for(let i=pairs.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pairs[i],pairs[j]]=[pairs[j],pairs[i]];}
    const leftoverColors=colors.filter(c=>!pairs.some(p=>p.color===c));
    setNames(names.map((_,i)=>pairs[i]?.name||""));
    setColors(names.map((_,i)=>pairs[i]?.color||leftoverColors.shift()||PALETTE[i%PALETTE.length]));
    setResults({});setSeries({});setGpLog([]);
  },[names,colors]);

  const handleSeededToggle=useCallback(()=>{
    if(seeded){
      const hasResults=Object.keys(results).length>0||gpLog.length>0;
      const ok=typeof window==="undefined"?true:window.confirm(hasResults
        ?"Random draw shuffles the running order and clears recorded results. Continue?"
        :"Random draw shuffles the running order so entry position doesn't matter. Continue?");
      if(!ok)return;
      handleShuffle();
      setSeeded(false);
    }else{
      setSeeded(true);
    }
  },[seeded,results,gpLog,handleShuffle]);

  const handleColorChange=useCallback((i:number,c:string)=>{
    setColors(prev=>{
      const a=normalizeColors(prev,Math.max(prev.length,i+1));
      const j=a.findIndex((x,k)=>x===c&&k!==i);
      if(j>=0)a[j]=a[i]; // that color is taken → the two racers swap, no duplicates ever
      a[i]=c;
      return a;
    });
    setPickerFor(null);
  },[]);

  const handleReset=useCallback(()=>{setResults({});setSeries({});setGpLog([]);},[]);
  const handleClearAll=useCallback(()=>{setNames(Array(playerCount).fill(""));setResults({});setSeries({});setGpLog([]);},[playerCount]);

  // Grand Prix: record / undo a heat result
  const handleRecordRace=useCallback((order:number[])=>{
    if(isSpectator)return;
    setGpLog(prev=>[...prev,order]);
  },[isSpectator]);
  const handleUndoRace=useCallback(()=>{
    if(isSpectator)return;
    setGpLog(prev=>prev.slice(0,-1));
  },[isSpectator]);

  const handleSlotClick=useCallback((matchId:string,slot:"A"|"B")=>{
    if(isSpectator)return;
    const def=BR.byId[matchId];
    const target=def?targetFor(def,format):1;
    let nextR={...results};
    const nextS:Series={...series};
    if(target<=1){
      if(nextR[matchId]===slot)delete nextR[matchId];else nextR[matchId]=slot;
      delete nextS[matchId];
    }else{
      if(nextR[matchId]){ // already decided → undo whole match
        delete nextR[matchId];delete nextS[matchId];
      }else{
        const cur=nextS[matchId]||{a:0,b:0};
        const s={a:cur.a,b:cur.b};
        if(slot==="A")s.a++;else s.b++;
        nextS[matchId]=s;
        if(s.a>=target||s.b>=target)nextR[matchId]=s.a>s.b?"A":"B";
      }
    }
    const cleaned=pruneState(BR,names,nextR,nextS);
    setResults(cleaned.results);setSeries(cleaned.series);
  },[isSpectator,BR,format,results,series,names]);

  const handleResetMatch=useCallback((matchId:string)=>{
    if(isSpectator)return;
    const nextR={...results};const nextS:Series={...series};
    delete nextR[matchId];delete nextS[matchId];
    const cleaned=pruneState(BR,names,nextR,nextS);
    setResults(cleaned.results);setSeries(cleaned.series);
  },[isSpectator,BR,results,series,names]);

  const handleFormatChange=useCallback((partial:Partial<Format>,resetNeeded:boolean)=>{
    if(resetNeeded){
      const msg=partial.mode?"Switching modes starts a fresh tournament. Continue?":"Changing the format clears recorded results. Continue?";
      const ok=typeof window==="undefined"?true:window.confirm(msg);
      if(!ok)return;
      setResults({});setSeries({});setGpLog([]);
    }
    setFormat(f=>({...f,...partial}));
  },[]);

  const editCopy=useCallback(()=>{
    // Spectator → take a local editable copy
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify({playerCount,names,results,series,format,gpLog,colors,seeded}));}catch{/* ignore */}
    location.href=location.origin+location.pathname;
  },[playerCount,names,results,series,format,gpLog,colors,seeded]);

  const M=compute(BR,names,results);
  const champ=getChampion(M);
  const runnerUp=getRunnerUp(M);
  const realCount=names.filter(n=>n&&n.trim()).length;
  const bracketCelebKey=champ?`s${champ.seed}|${realCount}p|${new Date().toISOString().slice(0,10)}`:"";
  const {open:bracketChampOpen,burst:bracketBurst,reopen:reopenBracketChamp,dismiss:dismissBracketChamp}=useEndCard(!!champ,bracketCelebKey);
  const isGP=format.mode==="gp";

  // Heats counter: fixed denominator from the start.
  // Bracket: a double-elim with N real racers always plays 2N-2 heats (plus one if a Grand Final reset is forced).
  // Grand Prix: the planned number of heats for everyone to race the chosen amount.
  let done=0,total=0;
  if(isGP){
    done=gpLog.length;
    total=gpTotalRaces(realCount,format.gpRaces);
  }else{
    for(const id in M){
      const m=M[id];if(!m.active)continue;
      const aR=m.a!==TBD&&m.a!==BYE,bR=m.b!==TBD&&m.b!==BYE;
      if(aR&&bR&&!m.auto&&m.decided)done++;
    }
    const gfReset=!!(M["GF2"]&&M["GF2"].active);
    total=realCount>=2?(2*realCount-2+(gfReset?1:0)):0;
  }
  const pct=total?Math.round(done/total*100):0;
  const S=nextPow2(playerCount),byes=S-playerCount;
  const capText=byes>0?`${byes} bye${byes>1?"s":""}→${S}-slot`:`clean ${S}-slot`;

  const wbGroups=BR.groups.filter(g=>g.bracket==="wb");
  const lbGroups=BR.groups.filter(g=>g.bracket==="lb");
  const gfMatches=M["GF2"]&&M["GF2"].active?["GF","GF2"]:["GF"];
  const showReset=M["GF"]?.decided&&M["GF"]?.winSlot==="B"&&!(M["GF2"]?.decided);

  const gfMatch=M["GF"];
  const gfA=gfMatch?.a!==TBD&&gfMatch?.a!==BYE&&gfMatch?.a?(gfMatch.a as Player).name??null:null;
  const gfB=gfMatch?.b!==TBD&&gfMatch?.b!==BYE&&gfMatch?.b?(gfMatch.b as Player).name??null:null;
  const gfBothKnown=!!(gfA&&gfB);
  let gfScoreA=1,gfScoreB=0;
  if(gfMatch?.decided){if(gfMatch.winSlot==="A")gfScoreA++;else gfScoreB++;}

  const wbRightConn=(i:number)=>i<wbGroups.length-1;
  const wbRightPair=(_i:number)=>true;
  const lbRightConn=(i:number)=>i%2===1&&i<lbGroups.length-1;
  const lbRightPair=(_i:number)=>true;

  const groupTitleById=useMemo(()=>{
    const map:Record<string,string>={};
    for(const g of BR.groups)for(const id of g.ids)map[id]=g.title;
    return map;
  },[BR]);

  const joinCode=sessionCode||liveCode;
  const colorOf=useCallback((seedIdx:number)=>colors[seedIdx]||PALETTE[seedIdx%PALETTE.length],[colors]);

  // ── Spectator predictions: poll the crowd, push my picks ──
  const predsActive=!!joinCode&&(isLive||liveStatus==="live");
  useEffect(()=>{
    if(!predsActive||!joinCode)return;
    let on=true;
    const tick=async()=>{
      try{
        const r=await fetch(`${API}/sessions/${joinCode}/predictions`);
        if(!r.ok)return;
        const j=await r.json();
        if(on&&j&&j.predictions&&typeof j.predictions==="object")setPreds(j.predictions as PredMap);
      }catch{/* transient */}
    };
    tick();
    const id=setInterval(tick,4000);
    return()=>{on=false;clearInterval(id);};
  },[predsActive,joinCode]);

  // Adopt any picks this device already made (e.g. after a page refresh).
  const adoptedPicks=useRef(false);
  useEffect(()=>{
    if(adoptedPicks.current)return;
    const mine=preds[getSid()];
    if(mine&&mine.picks){adoptedPicks.current=true;setMyPicks(mine.picks);if(mine.name&&!specName)setSpecName(mine.name);}
  },[preds,specName]);

  const pushMyPicks=useCallback((name:string,picks:Record<string,string>)=>{
    if(!joinCode)return;
    fetch(`${API}/sessions/${joinCode}/predictions/${getSid()}`,{
      method:"PUT",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({name,picks}),
    }).catch(()=>{/* transient */});
  },[joinCode]);

  const handlePick=useCallback((key:string,v:string)=>{
    setMyPicks(prev=>{
      const next={...prev};
      if(next[key]===v)delete next[key]; // tap your own pick again → clear it
      else next[key]=v;
      pushMyPicks(specName,next);
      setPreds(p=>({...p,[getSid()]:{name:specName,picks:next}}));
      return next;
    });
  },[pushMyPicks,specName]);

  const handleSpecName=useCallback((n:string)=>{
    setSpecName(n);
    try{localStorage.setItem(SPEC_NAME_KEY,n);}catch{/* ignore */}
    setMyPicks(prev=>{pushMyPicks(n,prev);return prev;});
  },[pushMyPicks]);
  const liveUrl=useMemo(()=>(joinCode&&typeof location!=="undefined")?`${location.origin}${location.pathname}?s=${joinCode}`:"",[joinCode]);
  const snapshotUrl=useMemo(()=>shareOpen?buildShareURL({playerCount,names,results,series,format,gpLog,colors,seeded,hofCode:crew||undefined}):"",[shareOpen,playerCount,names,results,series,format,gpLog,colors,seeded,crew]);

  // ── What the crowd can call right now ──
  const predItems:PredictableItem[]=[];
  if(predsActive){
    if(isGP){
      if(realCount>=2&&!gpComplete(realCount,format.gpRaces,gpLog)){
        const idx=gpLog.length;
        const heat=gpNextHeat(realCount,gpLog);
        predItems.push({key:`H:${idx}`,label:`Heat ${idx+1} · pick the winner`,
          options:heat.map(s=>({v:String(s),name:names[s]?.trim()||`Racer ${s+1}`,color:colorOf(s)}))});
      }
    }else{
      outer:
      for(const g of BR.groups){
        for(const id of g.ids){
          const m=M[id];
          if(!m||!m.active||m.decided||m.auto||m.phantom)continue;
          const aR=m.a!==TBD&&m.a!==BYE,bR=m.b!==TBD&&m.b!==BYE;
          if(!aR||!bR)continue;
          const a=m.a as Player,b=m.b as Player;
          const label=g.bracket==="gf"?(id==="GF2"?"Grand Final · Reset":"Grand Final"):`${g.title} · ${matchLabel(id)}`;
          predItems.push({key:`M:${id}`,label,options:[
            {v:"A",name:a.name??`Racer ${a.seed}`,color:colorOf(a.seed-1)},
            {v:"B",name:b.name??`Racer ${b.seed}`,color:colorOf(b.seed-1)},
          ]});
          if(predItems.length>=6)break outer;
        }
      }
    }
  }
  const scoreOf=useCallback((picks:Record<string,string>)=>{
    let correct=0,totalScored=0;
    for(const [k,v] of Object.entries(picks)){
      if(k.startsWith("M:")){
        const m=M[k.slice(2)];
        if(m&&m.active&&m.decided&&!m.auto&&!m.phantom){totalScored++;if(m.winSlot===v)correct++;}
      }else if(k.startsWith("H:")){
        const idx=Number(k.slice(2));
        const race=gpLog[idx];
        if(Array.isArray(race)&&race.length>0){totalScored++;if(race[0]===Number(v))correct++;}
      }
    }
    return {correct,total:totalScored};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[results,gpLog,names,playerCount]);

  // ── Tournament complete? Build recap rows + record the night in the Hall of Fame ──
  const gpDone=isGP&&realCount>=2&&gpComplete(realCount,format.gpRaces,gpLog);
  const gpRows=gpDone?gpStandings(realCount,gpLog):[];
  const tournamentComplete=isGP?gpDone:!!champ;
  let recapRows:{place:string;name:string;color:string;stat?:string}[]=[];
  if(gpDone){
    recapRows=gpRows.map(r=>({place:ord(r.rank),name:names[r.seed]?.trim()||`Racer ${r.seed+1}`,color:colorOf(r.seed),stat:`${r.points} pts · ${r.wins} heat win${r.wins===1?"":"s"}`}));
  }else if(champ){
    const wl:Record<number,{w:number;l:number}>={};
    for(const id in M){
      const m=M[id];if(!m.active||!m.decided||m.auto||m.phantom)continue;
      const w=m.winner,l=m.loser;
      if(w!==TBD&&w!==BYE){const p=w as Player;(wl[p.seed]=wl[p.seed]||{w:0,l:0}).w++;}
      if(l!==TBD&&l!==BYE){const p=l as Player;(wl[p.seed]=wl[p.seed]||{w:0,l:0}).l++;}
    }
    recapRows=bracketPlacements(M,names).map(r=>({place:ord(r.place),name:r.name,color:colorOf(r.seed-1),stat:wl[r.seed]?`${wl[r.seed].w}–${wl[r.seed].l}`:undefined}));
  }

  // Etch the night into the Hall of Fame the first time this completion is seen (host only).
  useEffect(()=>{
    if(isSpectator||!champ||isGP)return;
    const champName=champ.name?.trim();if(!champName)return;
    const key=`b|s${champ.seed}|${new Date().toISOString().slice(0,10)}|${realCount}p|${done}h`;
    try{if(localStorage.getItem(HOF_FLAG_PREFIX+key))return;localStorage.setItem(HOF_FLAG_PREFIX+key,"1");}catch{/* still dedup by key */}
    const stats:Record<string,HofStat>={};
    for(const id in M){
      const m=M[id];if(!m.active||!m.decided||m.auto||m.phantom)continue;
      const w=m.winner,l=m.loser;
      if(w!==TBD&&w!==BYE){const n=(w as Player).name?.trim();if(n){(stats[n]=stats[n]||{}).w=(stats[n].w||0)+1;}}
      if(l!==TBD&&l!==BYE){const n=(l as Player).name?.trim();if(n){(stats[n]=stats[n]||{}).l=(stats[n].l||0)+1;}}
    }
    (stats[champName]=stats[champName]||{}).t=1;
    const ru=getRunnerUp(M)?.name?.trim();
    recordHofEntry({key,date:new Date().toISOString(),mode:"bracket",champion:champName,runnerUp:ru||undefined,stats}).then(()=>setCrew(getHofCode()));
    reportToGameNight(key,bracketPlacements(M,names).map(r=>({name:r.name,place:r.place})));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[isSpectator,isGP,bracketCelebKey]);

  useEffect(()=>{
    if(isSpectator||!gpDone||gpRows.length===0)return;
    const champName=names[gpRows[0].seed]?.trim();if(!champName)return;
    const key=`g|s${gpRows[0].seed}|${new Date().toISOString().slice(0,10)}|${realCount}p|${gpLog.length}h`;
    try{if(localStorage.getItem(HOF_FLAG_PREFIX+key))return;localStorage.setItem(HOF_FLAG_PREFIX+key,"1");}catch{/* still dedup by key */}
    const stats:Record<string,HofStat>={};
    for(const r of gpRows){
      const n=names[r.seed]?.trim();if(!n)continue;
      stats[n]={p:r.points,hw:r.wins};
    }
    (stats[champName]=stats[champName]||{}).g=1;
    const ru=gpRows.length>1?names[gpRows[1].seed]?.trim():undefined;
    recordHofEntry({key,date:new Date().toISOString(),mode:"gp",champion:champName,runnerUp:ru||undefined,stats}).then(()=>setCrew(getHofCode()));
    reportToGameNight(key,gpRows.map((r,i)=>({name:(names[r.seed]??"").trim(),place:i+1})).filter(x=>x.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[isSpectator,gpDone,gpLog.length]);

  if(gnResolving){
    return(
      <div className="beerio-root min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="font-[Luckiest_Guy,cursive] text-[34px] text-[var(--sun)] m-0"
          style={{WebkitTextStroke:"2px var(--ink)",textShadow:"3px 3px 0 var(--ink)"}}>
          BEERIO KART
        </h1>
        <p className="font-[Fredoka] font-semibold text-[16px] text-[var(--ink)] max-w-[320px]">
          Connecting to the night&hellip;
        </p>
        <button onClick={()=>{if(window.history.length>1)history.back();else gnNavigate("/");}}
          className="px-4 py-2 rounded-[10px] border-2 border-[var(--ink)] bg-[var(--foam)] font-[Fredoka] font-semibold text-[13px] text-[var(--ink)] shadow-[0_2px_0_rgba(22,35,59,.22)] cursor-pointer">
          &larr; Back to event
        </button>
      </div>
    );
  }

  if(gnWaiting){
    return(
      <div className="beerio-root min-h-dvh flex flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="font-[Luckiest_Guy,cursive] text-[34px] text-[var(--sun)] m-0"
          style={{WebkitTextStroke:"2px var(--ink)",textShadow:"3px 3px 0 var(--ink)"}}>
          BEERIO KART
        </h1>
        <p className="font-[Fredoka] font-semibold text-[16px] text-[var(--ink)] max-w-[320px]">
          Waiting for the host to start the night. This page updates on its own.
        </p>
        <button onClick={()=>{if(window.history.length>1)history.back();else gnNavigate("/");}}
          className="px-4 py-2 rounded-[10px] border-2 border-[var(--ink)] bg-[var(--foam)] font-[Fredoka] font-semibold text-[13px] text-[var(--ink)] shadow-[0_2px_0_rgba(22,35,59,.22)] cursor-pointer">
          &larr; Back to event
        </button>
      </div>
    );
  }

  return(
    <ColorsCtx.Provider value={colors}>
      {statsNotice&&(
        <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-[80] max-w-[92vw] px-4 py-2 rounded-[12px] border-2 border-[var(--ink)] bg-[var(--foam)] shadow-[0_3px_0_rgba(22,35,59,.22)] flex items-center gap-3">
          <span className="font-[Fredoka] font-semibold text-[13px] text-[var(--ink)]">{statsNotice}</span>
          <button onClick={()=>setStatsNotice(null)} className="font-[Fredoka] font-bold text-[13px] text-[var(--ink)] opacity-60 cursor-pointer">x</button>
        </div>
      )}
      {/* Portrait blocker (tablets only) */}
      <div className="app-portrait-blocker">
        <div className="rp-card">
          <span className="rp-ic">📱</span>
          <h2>TURN ME SIDEWAYS</h2>
          <p>This bracket is built for landscape. Rotate to start racing.</p>
        </div>
      </div>

      <div className="app-main min-h-screen">
        {rulesOpen&&<RulesModal onClose={()=>setRulesOpen(false)}/>}
        {formatOpen&&<FormatModal format={format} onChange={handleFormatChange} onClose={()=>setFormatOpen(false)}/>}
        {hofOpen&&<HofModal viewCode={isSpectator?crew:undefined} onClose={()=>{setHofOpen(false);if(!isSpectator)setCrew(getHofCode());}}/>}
        {recapOpen&&tournamentComplete&&<RecapModal mode={format.mode} rows={recapRows} heats={done} onClose={()=>setRecapOpen(false)}/>}
        {shareOpen&&<ShareModal code={sessionCode} status={liveStatus} liveUrl={liveUrl} snapshotUrl={snapshotUrl} onClose={()=>setShareOpen(false)} onRetry={startLive}/>}
        {!shareOpen&&(
          <FloatingQR liveUrl={liveUrl} status={liveStatus} canGoLive={!isSpectator} isSpectator={isSpectator}
            onGoLive={()=>{setShareOpen(true);startLive();}} onOpen={()=>{setShareOpen(true);startLive();}}/>
        )}

        {/* Header */}
        <header className="relative border-b-[3px] border-[var(--ink)] overflow-hidden" style={{
          background:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1440 180' preserveAspectRatio='none'%3E%3Cg fill='%23FFFFFF'%3E%3Cellipse cx='170' cy='44' rx='72' ry='26'/%3E%3Cellipse cx='232' cy='36' rx='46' ry='22'/%3E%3Cellipse cx='1080' cy='50' rx='88' ry='32'/%3E%3Cellipse cx='1160' cy='38' rx='58' ry='24'/%3E%3C/g%3E%3C/svg%3E") no-repeat top/100%,linear-gradient(180deg,var(--sky-top) 0%,var(--sky-bot) 78%)`}}>
          <div className="h-3" style={{backgroundImage:"linear-gradient(45deg,#16233B 25%,transparent 25%),linear-gradient(-45deg,#16233B 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#16233B 75%),linear-gradient(-45deg,transparent 75%,#16233B 75%)",backgroundSize:"12px 12px",backgroundPosition:"0 0,0 6px,6px -6px,-6px 0",backgroundColor:"#FFF",borderBottom:"2.5px solid var(--ink)"}}/>
          <div className="relative z-10 max-w-[1360px] mx-auto px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
            <div className="flex flex-col gap-2">
              <h1 className="font-[Luckiest_Guy,cursive] text-[clamp(20px,3.4vw,38px)] m-0 leading-none tracking-wide text-[var(--sun)]"
                style={{WebkitTextStroke:"2px var(--ink)",textShadow:"3px 3px 0 var(--ink)",transform:"rotate(-2deg)"}}>BEERIO KART</h1>
              <div className="font-[Fredoka] font-semibold text-[11.5px] tracking-wider text-[var(--ink)] bg-[var(--foam)] border-2 border-[var(--ink)] rounded-full px-2.5 py-1 inline-flex items-center gap-2 self-start shadow-[0_2px_0_rgba(22,35,59,.18)]">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--grass)] shadow-[0_0_0_1.5px_var(--ink)]"/>
                {isSpectator?(isLive?"📺 Live Spectator":"📺 Spectator View"):(sessionCode&&liveStatus==="live"?`🔴 LIVE · Room ${sessionCode}`:"🏎️ Double Elimination Night")}
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              {(
                <button onClick={()=>{if(window.history.length>1)history.back();else location.href="/";}}
                  className="px-3 py-1.5 rounded-[9px] border-2 border-[var(--ink)] bg-[var(--foam)] font-[Fredoka] font-semibold text-[12px] text-[var(--ink)] shadow-[0_2px_0_rgba(22,35,59,.22)] cursor-pointer">
                  &larr; Back
                </button>
              )}
              {!isSpectator&&sessionCode&&(
                <button onClick={()=>gnNavigate(`/beerio/tv/${sessionCode}`)}
                  className="px-3 py-1.5 rounded-[9px] border-2 border-[var(--ink)] bg-[var(--sun)] font-[Fredoka] font-semibold text-[12px] text-[var(--ink)] shadow-[0_2px_0_rgba(22,35,59,.22)] cursor-pointer">
                  📺 TV Mode
                </button>
              )}
              {!isSpectator&&(
                <button onClick={()=>setFormatOpen(true)} title="Format"
                  className="w-9 h-9 rounded-[10px] border-2 border-[var(--ink)] bg-[var(--foam)] text-[var(--ink)] text-[15px] grid place-items-center shadow-[0_3px_0_rgba(22,35,59,.22)] hover:bg-white active:translate-y-px transition-all cursor-pointer flex-shrink-0" style={{touchAction:"manipulation"}}>⚙️</button>
              )}
              <button onClick={()=>setHofOpen(true)} title="Hall of Fame"
                className="w-9 h-9 rounded-[10px] border-2 border-[var(--ink)] bg-[var(--foam)] text-[var(--ink)] text-[15px] grid place-items-center shadow-[0_3px_0_rgba(22,35,59,.22)] hover:bg-white active:translate-y-px transition-all cursor-pointer flex-shrink-0" style={{touchAction:"manipulation"}}>🏆</button>
              <button onClick={()=>setRulesOpen(true)} title="Rules"
                className="w-9 h-9 rounded-[10px] border-2 border-[var(--ink)] bg-[var(--foam)] text-[var(--ink)] text-[15px] grid place-items-center shadow-[0_3px_0_rgba(22,35,59,.22)] hover:bg-white active:translate-y-px transition-all cursor-pointer flex-shrink-0" style={{touchAction:"manipulation"}}>ℹ️</button>
              <div className="flex items-center gap-3.5 bg-[var(--foam)] border-2 border-[var(--ink)] rounded-[11px] px-3 py-2 shadow-[0_3px_0_rgba(22,35,59,.18)]">
                <BeerMug pct={pct}/>
                <div className="font-[Fredoka]">
                  <div className="text-[19px] font-bold text-[var(--ink)] leading-none">{done} / {total}</div>
                  <div className="text-[10px] text-[var(--ink-soft)] tracking-widest font-semibold mt-0.5">{isGP?"🏎️ Heats Run":"🍄 Heats Run"}</div>
                </div>
              </div>
            </div>
          </div>
        </header>

        {/* Spectator banner */}
        {isSpectator&&(
          <div className="max-w-[1360px] mx-auto px-4 mt-3">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-[var(--grape)] text-white border-2 border-[var(--ink)] rounded-[11px] px-4 py-2 shadow-[0_3px_0_rgba(22,35,59,.22)]">
              <span className="font-[Fredoka] font-semibold text-[12.5px] flex items-center gap-2">
                {isLive?(
                  <>
                    <span className="w-2.5 h-2.5 rounded-full inline-block" style={{background:liveStatus==="live"?"#7CFFB0":"#FFC9C9"}}/>
                    {liveStatus==="error"?"Can't reach the host. The room may have ended.":liveStatus==="live"?"Watching live, updates automatically.":"Connecting to live room…"}
                  </>
                ):"📺 You're watching a shared snapshot, read only."}
              </span>
              <button onClick={editCopy} style={{touchAction:"manipulation"}}
                className="font-[Fredoka] font-bold text-[12px] bg-white text-[var(--ink)] border-2 border-[var(--ink)] rounded-[8px] px-3 py-1 shadow-[0_2px_0_rgba(22,35,59,.25)] active:translate-y-px cursor-pointer">Edit a copy</button>
            </div>
          </div>
        )}

        {/* Crowd predictions (live rooms only) */}
        {predsActive&&(
          <Predictions
            canPick={predsActive} preds={preds}
            myName={specName} onName={handleSpecName}
            myPicks={myPicks} onPick={handlePick}
            items={predItems} scoreOf={scoreOf}
            defaultOpen={isLive}/>
        )}

        {/* Controls (hidden for spectators) */}
        {!isSpectator&&(
          <div className="max-w-[1360px] mx-auto px-4 py-3.5 flex flex-wrap gap-5 items-start">
            <div className="flex-1 min-w-[260px]">
              <div className="font-[Fredoka] font-bold text-[13.5px] text-[var(--ink)] mb-2 flex items-center gap-2.5 flex-wrap">
                <span>Racers</span>
                <span className="inline-flex items-center gap-1.5">
                  <button onClick={()=>handleSetCount(playerCount-1)} disabled={playerCount<=MIN_PLAYERS} style={{touchAction:"manipulation"}}
                    className="w-6 h-6 rounded-[6px] border-2 border-[var(--ink)] bg-[var(--sun)] text-[var(--ink)] font-bold text-base cursor-pointer grid place-items-center shadow-[0_2px_0_rgba(22,35,59,.26)] active:translate-y-px transition-all disabled:opacity-40 hover:bg-[var(--sun-deep)]">−</button>
                  <span className="font-bold text-[19px] text-[var(--ink)] min-w-[24px] text-center">{playerCount}</span>
                  <button onClick={()=>handleSetCount(playerCount+1)} disabled={playerCount>=MAX_PLAYERS} style={{touchAction:"manipulation"}}
                    className="w-6 h-6 rounded-[6px] border-2 border-[var(--ink)] bg-[var(--sun)] text-[var(--ink)] font-bold text-base cursor-pointer grid place-items-center shadow-[0_2px_0_rgba(22,35,59,.26)] active:translate-y-px transition-all disabled:opacity-40 hover:bg-[var(--sun-deep)]">+</button>
                  <span className="font-[Nunito] font-semibold text-[10px] text-[var(--muted)]">{capText}</span>
                  <span className="font-[Nunito] font-semibold text-[10px] text-[var(--ink)] bg-[var(--card2)] border border-[var(--ink)] rounded-full px-2 py-px">
                    {isGP?`grand prix · ${format.gpRaces} each`:`bracket · ${format.series===1?"single":format.series===2?"Bo3":"Bo5"}`}
                  </span>
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mb-2">
                {names.map((name,i)=>(
                  <div key={i} className="relative">
                    <button type="button" title="Tap to change kart color" onClick={()=>setPickerFor(pickerFor===i?null:i)} style={{touchAction:"manipulation",background:colorOf(i),color:textOn(colorOf(i))}}
                      className="absolute left-2 top-1/2 -translate-y-1/2 font-[Fredoka] font-bold text-[11px] border border-[var(--ink)] w-[20px] h-[20px] rounded-[5px] grid place-items-center z-10 cursor-pointer shadow-[0_1px_0_rgba(22,35,59,.3)]">{i+1}</button>
                    <input type="text" value={name} onChange={e=>handleNameChange(i,e.target.value)}
                      placeholder={`Racer ${i+1}`} maxLength={18} autoComplete="off" style={{borderLeft:`5px solid ${colorOf(i)}`}}
                      className="w-full pl-8 pr-2 py-1.5 bg-white border-2 border-[var(--ink)] rounded-[8px] text-[var(--ink)] font-[Nunito] text-[12.5px] font-bold outline-none shadow-[0_2px_0_rgba(22,35,59,.1)] focus:shadow-[0_0_0_2px_var(--sun),0_2px_0_rgba(22,35,59,.1)] placeholder:text-[#A9B2C2]"/>
                    {!name.trim()&&<span className="absolute right-1.5 top-1/2 -translate-y-1/2 font-[Fredoka] font-bold text-[8.5px] text-white bg-[var(--coral)] border border-[var(--ink)] rounded-[3px] px-1 py-px pointer-events-none">BYE</span>}
                    {pickerFor===i&&(
                      <div className="absolute left-0 top-full mt-1 z-30 bg-white border-2 border-[var(--ink)] rounded-[10px] p-2 shadow-[0_4px_0_rgba(22,35,59,.22)] grid grid-cols-8 gap-1.5 w-max">
                        {PALETTE.map(c=>{
                          const owner=colors.findIndex((x,k)=>x===c&&k!==i&&k<playerCount);
                          return(
                            <button key={c} type="button" onClick={()=>handleColorChange(i,c)} title={owner>=0?`Taken by Racer ${owner+1} — tap to swap`:"Pick this color"}
                              style={{background:c,color:textOn(c),touchAction:"manipulation"}}
                              className={`w-7 h-7 rounded-[6px] border-2 grid place-items-center font-[Fredoka] font-bold text-[10px] leading-none cursor-pointer ${colorOf(i)===c?"border-[var(--ink)] outline outline-2 outline-[var(--sun)]":"border-[var(--ink)] opacity-90 hover:opacity-100"}`}>{owner>=0?owner+1:colorOf(i)===c?i+1:""}</button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <label className="flex items-center gap-1.5 font-[Fredoka] font-bold text-[11.5px] text-[var(--ink)] cursor-pointer select-none" style={{touchAction:"manipulation"}}>
                  <input type="checkbox" checked={seeded} onChange={handleSeededToggle}
                    className="w-4 h-4 accent-[var(--grass)] cursor-pointer"/>
                  Seeds matter
                </label>
                <p className="text-[11px] text-[var(--muted)] font-semibold leading-relaxed m-0">
                  {seeded?"Seed 1 is strongest. Empty slots are byes. Shuffle to randomize.":"🎲 Random draw night, the order was shuffled and seeds mean nothing. Tap a number to change a kart color."}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 min-w-[152px]">
              {[{icon:"❓",label:"Shuffle seeds",onClick:handleShuffle,p:true},{icon:"↺",label:"Reset results",onClick:handleReset,p:false},{icon:"🧹",label:"Clear names",onClick:handleClearAll,p:false}].map(btn=>(
                <button key={btn.label} onClick={btn.onClick} style={{touchAction:"manipulation"}}
                  className={`font-[Fredoka] tracking-wide font-semibold text-[12.5px] cursor-pointer px-3 py-2 rounded-[9px] border-2 border-[var(--ink)] text-[var(--ink)] shadow-[0_3px_0_rgba(22,35,59,.22)] active:translate-y-[2px] active:shadow-[0_1px_0_rgba(22,35,59,.22)] transition-all text-left flex items-center gap-2 ${btn.p?"bg-[var(--sun)] hover:bg-[var(--sun-deep)]":"bg-white hover:bg-[#F5EFE0]"}`}>
                  <span>{btn.icon}</span>{btn.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Stage */}
        <div className="max-w-[1360px] mx-auto px-4 pb-12">
          {tournamentComplete&&(
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button onClick={()=>setRecapOpen(true)} style={{touchAction:"manipulation"}}
                className="font-[Fredoka] font-bold text-[13px] px-4 py-2.5 rounded-[10px] border-2 border-[var(--ink)] bg-[var(--sun)] text-[var(--ink)] shadow-[0_3px_0_rgba(22,35,59,.22)] hover:bg-[var(--sun-deep)] active:translate-y-px transition-all cursor-pointer">
                📸 Results card
              </button>
              <button onClick={()=>setHofOpen(true)} style={{touchAction:"manipulation"}}
                className="font-[Fredoka] font-bold text-[13px] px-4 py-2.5 rounded-[10px] border-2 border-[var(--ink)] bg-white text-[var(--ink)] shadow-[0_3px_0_rgba(22,35,59,.22)] hover:bg-[#F5EFE0] active:translate-y-px transition-all cursor-pointer">
                🏆 Hall of Fame
              </button>
              <span className="font-[Nunito] font-semibold text-[11px] text-[var(--muted)]">Tonight's result {isSpectator?"is on the board.":"was saved to the Hall of Fame."}</span>
            </div>
          )}
          {realCount<2?(
            <div className="mt-6 border-2 border-dashed border-[var(--ink)] rounded-[14px] p-10 text-center bg-[#FBF6EA]">
              <span className="text-4xl block mb-3">🏁</span>
              <h3 className="font-[Luckiest_Guy,cursive] text-[var(--ink)] text-xl tracking-wider m-0 mb-2">READY TO RACE?</h3>
              <p className="font-[Nunito] font-semibold text-[var(--muted)] text-[13px] m-0 leading-relaxed">Drop in at least two racer names above and {isGP?"start your Grand Prix.":"the bracket builds itself."}</p>
            </div>
          ):isGP?(
            <GrandPrix names={names} realCount={realCount} gpLog={gpLog} target={format.gpRaces}
              readOnly={isSpectator} onRecord={handleRecordRace} onUndo={handleUndoRace}/>
          ):(
            <>
              <BracketSection groups={wbGroups} M={M} onSlotClick={handleSlotClick}
                tagColor="var(--grass)" tagText="Winners Bracket" pipColor="var(--grass)"
                slotHFor={i=>wbSlotH(i+1)} rightConnFor={wbRightConn} rightPairFor={wbRightPair}
                seriesMap={series} format={format} readOnly={isSpectator} onReset={handleResetMatch}/>

              {lbGroups.length>0&&(
                <BracketSection groups={lbGroups} M={M} onSlotClick={handleSlotClick}
                  tagColor="var(--coral)" tagText="Losers Bracket" pipColor="var(--coral)"
                  slotHFor={i=>lbSlotH(i)} rightConnFor={lbRightConn} rightPairFor={lbRightPair}
                  seriesMap={series} format={format} readOnly={isSpectator} onReset={handleResetMatch}/>
              )}

              {/* Grand Final */}
              <section className="mt-5">
                <div className="flex items-center gap-3 mb-2.5">
                  <span className="w-3 h-3 border-2 border-[var(--ink)] rotate-45 rounded-sm" style={{background:"var(--grape)"}}/>
                  <span className="font-[Luckiest_Guy,cursive] text-[17px] tracking-wider text-white rounded-[9px] px-3 py-0.5 shadow-[0_3px_0_rgba(22,35,59,.22)]"
                    style={{background:"var(--grape)",border:"2px solid var(--ink)",transform:"rotate(-1deg)"}}>Grand Final</span>
                  <span className="h-[2px] bg-[var(--ink)] opacity-15 flex-1 rounded"/>
                </div>

                {gfBothKnown&&!champ&&(
                  <div className="mb-3 inline-flex items-center gap-0 border-2 border-[var(--ink)] rounded-[10px] overflow-hidden shadow-[0_2px_0_rgba(22,35,59,.18)]">
                    <div className={`flex items-center gap-2 px-3 py-1.5 ${gfScoreA>gfScoreB?"bg-[var(--sun)]":"bg-white"}`}>
                      <span className="font-[Fredoka] font-bold text-[12px] text-[var(--ink)] max-w-[110px] truncate">{gfA}</span>
                      <span className="font-[Luckiest_Guy,cursive] text-[20px] text-[var(--ink)] leading-none">{gfScoreA}</span>
                    </div>
                    <div className="w-px self-stretch bg-[var(--ink)]"/>
                    <div className="px-2 py-1.5 bg-[var(--grape)] flex flex-col items-center gap-0">
                      <span className="font-[Fredoka] font-bold text-[8px] text-white tracking-widest uppercase leading-none">First to</span>
                      <span className="font-[Luckiest_Guy,cursive] text-[13px] text-white leading-none">2</span>
                    </div>
                    <div className="w-px self-stretch bg-[var(--ink)]"/>
                    <div className={`flex items-center gap-2 px-3 py-1.5 ${gfScoreB>gfScoreA?"bg-[var(--sun)]":"bg-white"}`}>
                      <span className="font-[Luckiest_Guy,cursive] text-[20px] text-[var(--ink)] leading-none">{gfScoreB}</span>
                      <span className="font-[Fredoka] font-bold text-[12px] text-[var(--ink)] max-w-[110px] truncate">{gfB}</span>
                    </div>
                    <div className="w-px self-stretch bg-[var(--ink)]"/>
                    <div className="px-2 py-1.5 bg-[#F0F8FF]">
                      <span className="font-[Fredoka] font-bold text-[8.5px] text-[var(--ink)] tracking-wide leading-tight whitespace-nowrap">WB starts<br/>1–0</span>
                    </div>
                  </div>
                )}
                <div className="flex flex-wrap gap-4 items-center">
                  <div className="flex flex-col gap-2" style={{width:CARD_W}}>
                    {gfMatches.map(id=>(
                      <MatchCard key={id} m={M[id]} onSlotClick={handleSlotClick} label={id==="GF"?"Game 1":"Reset · G2"}
                        seriesMap={series} format={format} readOnly={isSpectator} onReset={handleResetMatch}/>
                    ))}
                    {showReset&&<p className="font-[Nunito] text-[10.5px] font-bold text-[var(--grape-deep)] leading-snug">Lower-bracket forced a reset. One more game decides it.</p>}
                  </div>
                  {champ?(
                    <div className="flex-1 min-w-[220px]">
                      <ChampionChip label={`${champ.name?.trim()||`Racer ${champ.seed+1}`} is the Champion`} onClick={reopenBracketChamp}/>
                      <ChampionModal
                        open={bracketChampOpen} onClose={dismissBracketChamp} burstKey={bracketCelebKey} celebrate={bracketBurst>0}
                        kicker="🏆 Champion 🏆"
                        name={champ.name?.trim()||`Racer ${champ.seed+1}`}
                        detail="Drinks are on the winner 🍺"
                        podiumRows={runnerUp?[{label:"🥈 Runner-up",name:runnerUp.name?.trim()||`Racer ${runnerUp.seed+1}`,color:colorOf(runnerUp.seed-1)}]:[]}
                      />
                    </div>
                  ):(
                    <div className="flex-1 min-w-[180px] max-w-[240px] rounded-xl border-2 border-dashed border-[var(--ink)] flex flex-col items-center justify-center gap-1.5 px-5 py-4 text-center bg-[#FBF6EA]">
                      <span className="text-3xl">🏁</span>
                      <span className="font-[Fredoka] tracking-[2px] text-[9.5px] text-[var(--sun-deep)] font-bold uppercase">Champion</span>
                      <span className="font-[Fredoka] font-semibold text-[var(--muted)] text-[13px]">To be crowned</span>
                    </div>
                  )}
                </div>
              </section>

              {/* Legend */}
              <div className="flex flex-wrap gap-3 mt-5 pt-3 border-t-2 border-dotted border-[#C9BFA8] font-[Nunito] text-[11px] font-bold text-[var(--ink-soft)]">
                {([
                  ["rgba(47,185,105,0.45)","var(--grass)","🍄 Winners"],
                  ["rgba(255,90,90,0.45)","var(--coral)","🐢 Losers"],
                  ["rgba(124,92,255,0.45)","var(--grape)","⭐ Grand Final"],
                ] as [string,string,string][]).map(([bg,border,l])=>(
                  <span key={l} className="flex items-center gap-1"><span className="w-3 h-3 rounded-[3px] border-2" style={{background:bg,borderColor:border}}/>{l}</span>
                ))}
                <span>{isSpectator?"📺 Read-only spectator view":"👉 Tap a racer to mark the heat winner. Tap again to undo."}</span>
              </div>
              <p className="mt-2 font-[Nunito] text-[11px] font-semibold text-[var(--muted)] leading-relaxed">
                🍌 Finish your drink before crossing the line. First loss → Losers. Second loss → you're out. WB champ starts the Grand Final one game up.
              </p>

              {/* Match history */}
              <MatchHistory BR={BR} M={M} series={series} groupTitleById={groupTitleById}/>
            </>
          )}
        </div>
      </div>
    </ColorsCtx.Provider>
  );
}

import assert from 'node:assert/strict';import fs from 'node:fs';import{createRequire}from'node:module';const require=createRequire(import.meta.url);
const{valid,relative,sortFolders}=require('./activity.cjs'),{accordionQueue,installTooltip,ANIMATION_MS}=require('./interaction.cjs');assert.equal(ANIMATION_MS,320);
const now=new Date('2026-09-20T12:00:00Z');
for(const value of ['2026-02-30T12:00:00Z','2026-04-31T12:00:00Z','2025-02-29T00:00:00Z','1900-02-29T00:00:00Z','2026-01-01T24:00:00Z','2026-01-01T00:00:00+25:00','2026-09-21T00:00:00Z','bad',null])assert.equal(valid(value,now),null,value);
for(const value of ['2024-02-29T12:00:00Z','2000-02-29T00:00:00Z','2026-09-20T13:00:00+03:00','2026-09-20T08:00:00-03:00'])assert(valid(value,now),value);
const stamp=new Date(2026,8,20,0,0).toISOString();assert.match(relative(stamp,new Date(2026,8,20,23,59)),/^Сегодня/);assert.equal(relative(stamp,new Date(2026,8,21,0,0)),'Вчера');assert.equal(stamp,new Date(2026,8,20,0,0).toISOString());
const rows=[{id:'old',name:'Старая',current:true,activity:'2026-01-01T00:00:00Z'},{id:'new',name:'Новая',activity:stamp}];for(const d of [new Date(2026,8,20,23,59),new Date(2026,8,21,0,0)])assert.equal(sortFolders(rows,d)[0].id,'old');
for(const reduced of [false,true]){
 let pending=[],applied='A';const q=accordionQueue('A',async target=>{if(!reduced)await new Promise(r=>pending.push(r));applied=target;});
 async function flush(){for(let i=0;i<20;i++){while(pending.length)pending.shift()();await Promise.resolve();}await q.idle;}
 q.request('B');q.request('C');await flush();assert.equal(applied,'C');
 q.request('B');q.request('B');await flush();assert.equal(applied,null);
 q.request('A');await flush();q.request('B');q.request('A');if(pending.length)pending.shift()();await Promise.resolve();q.request('C');await flush();assert.equal(applied,'C');
 for(const x of ['A','B','C','A','B','B','C'])q.request(x);await flush();assert.equal(applied,'C');
}
// Офлайн реальные tooltip-обработчики, без браузера или имитации рендера.
const handlers={},timers=new Map();let serial=0;
const tip={hidden:true,style:{},offsetWidth:200,offsetHeight:100,contains:n=>n===tip,removeAttribute(){}};
const panel={querySelector:()=>tip,contains:n=>n===a||n===b||n===tip,addEventListener:(name,fn)=>handlers[name]=fn};
const env={innerWidth:300,innerHeight:240,addEventListener(){},setTimeout:fn=>{timers.set(++serial,fn);return serial;},clearTimeout:id=>timers.delete(id)};
const make=name=>({dataset:{tip:name},attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},closest(){return this;},getBoundingClientRect:()=>({left:280,bottom:220}),focus(){}});
const a=make('A'),b=make('B');installTooltip(panel,env);const tick=()=>{for(const fn of [...timers.values()])fn();timers.clear();};
assert.equal(handlers.focusin,undefined);assert.equal(handlers.focusout,undefined);assert(tip.hidden);
handlers.keydown({key:'Tab'});assert(tip.hidden);
handlers.pointerover({target:a});assert(!tip.hidden);assert(a.attrs['aria-describedby']);
handlers.pointerover({target:b});assert.equal(tip.textContent,'B');handlers.keydown({key:'Escape'});tick();assert(tip.hidden);assert(!b.attrs['aria-describedby']);
handlers.pointerover({target:b});assert(tip.hidden,'Escape remains dismissed for same trigger');
handlers.pointerout({target:b,relatedTarget:null});tick();assert(tip.hidden);
handlers.pointerover({target:a});handlers.pointerout({target:a,relatedTarget:tip});assert(tip.hidden);handlers.pointerover({target:tip});tick();assert(tip.hidden);handlers.pointerover({target:a});assert.equal(tip.textContent,'A');assert.equal(tip.tabIndex,-1);
assert.equal(tip.style.left,'280px');assert.equal(tip.style.top,'220px');assert.equal(tip.style.maxHeight,undefined);assert.equal(tip.style.maxWidth,undefined);
const foreign=make('Другая панель');handlers.pointerout({target:tip,relatedTarget:foreign});tick();assert(tip.hidden,'Foreign panel must not own this tooltip');
for(const file of ['01-monograms.html','vscode-monograms/02-inset.html']){const html=fs.readFileSync(new URL(file,import.meta.url),'utf8');const names=[...html.matchAll(/class="folder-head" data-tip="([^"]+)"[\s\S]*?class="name">([^<]+)<\/span>/g)];assert.equal(names.length,file.startsWith('01')?64:48);for(const [,path,name]of names)assert.equal(path,`D:\\Примеры\\${name}`.replaceAll('\\\\','\\'));assert(!html.includes('${'));assert(html.includes('interaction.cjs'));}
console.log('PASS regressions: paths112, strict/leap/timezone dates, midnight/current-first, latest accordion intent (normal/reduced), tooltip hover-only/pointer/Escape/timers/unclamped anchor. DOM rendering not tested.');

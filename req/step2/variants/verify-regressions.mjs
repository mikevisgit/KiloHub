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
// Офлайн вызываются реальные tooltip-обработчики; геометрия задаётся числами, а не браузерным layout.
const handlers={},timers=new Map();let serial=0;
const tip={hidden:true,style:{},attrs:{},offsetWidth:200,offsetHeight:100,contains:n=>n===tip,setAttribute(k,v){this.attrs[k]=v;}};
const panel={querySelector:()=>tip,contains:n=>n===a||n===b||n===tip,addEventListener:(name,fn)=>handlers[name]=fn};
const env={innerWidth:300,innerHeight:240,addEventListener(){},setTimeout:fn=>{const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)};
const make=name=>({dataset:{tip:name},attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},closest(){return this;},getBoundingClientRect:()=>({left:280,top:200,bottom:220})});
const a=make('A'),b=make('B');installTooltip(panel,env);const tick=()=>{const pending=[...timers.values()];timers.clear();for(const fn of pending)fn();};
handlers.pointerover({target:a,relatedTarget:null});assert(!tip.hidden);assert(a.attrs['aria-describedby']);assert.equal(tip.style.left,'92px');assert.equal(tip.style.top,'96px');
handlers.pointerout({target:a,relatedTarget:null});handlers.pointerover({target:tip,relatedTarget:null});tick();assert(!tip.hidden,'popup hover survives source leave');
handlers.pointerout({target:tip,relatedTarget:null});tick();assert(tip.hidden);
handlers.focusin({target:b});assert.equal(tip.textContent,'B');handlers.keydown({key:'Escape'});assert(tip.hidden);handlers.focusin({target:b});assert(tip.hidden);handlers.focusout({target:b,relatedTarget:null});handlers.focusin({target:b});assert(!tip.hidden);
for(const file of ['01-monograms.html']){const html=fs.readFileSync(new URL(file,import.meta.url),'utf8');const names=[...html.matchAll(/class="folder-head" data-tip="([^"]+)"[\s\S]*?class="name">([^<]+)<\/span>/g)];assert.equal(names.length,64);for(const [,path,name]of names)assert.equal(path,`D:\\Примеры\\${name}`.replaceAll('\\\\','\\'));assert(!html.includes('${'));assert(html.includes('interaction.cjs'));assert(!/<p class="dialogue"[^>]*tabindex/.test(html));assert(/<p class="dialogue" data-tip="[^"]+">/.test(html));}
const semanticHtml=fs.readFileSync(new URL('01-monograms.html',import.meta.url),'utf8');assert.equal((semanticHtml.match(/<h2 tabindex="0" data-tip="[^"]+">Последние диалоги<\/h2>/g)||[]).length,64);assert(!/<h3[^>]*>Последние диалоги<\/h3>/.test(semanticHtml));for(const cssFile of ['panel.css','refinements.css','scale.css']){const css=fs.readFileSync(new URL(cssFile,import.meta.url),'utf8');assert(css.includes('.history h2'));assert(!css.includes('.history h3'));}
console.log('PASS regressions: paths64, strict/leap/timezone dates, midnight/current-first, latest accordion intent, accessible tooltip pointer/focus/popup/Escape and viewport fit. DOM rendering not tested.');

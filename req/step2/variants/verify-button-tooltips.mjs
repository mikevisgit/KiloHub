import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const {installTooltip,TOOLTIP_GRACE_MS}=createRequire(import.meta.url)('./interaction.cjs');

function harness({width=320,height=260}={}){
 const handlers={},global={},timers=new Map();let serial=0;const nodes=[];
 const tip={hidden:true,style:{},attrs:{},offsetWidth:200,offsetHeight:100,contains:n=>n===tip,setAttribute(k,v){this.attrs[k]=v;}};
 const panel={querySelector:()=>tip,contains:n=>nodes.includes(n)||n===tip,addEventListener:(k,f)=>handlers[k]=f};
 const env={innerWidth:width,innerHeight:height,addEventListener:(k,f)=>global[k]=f,setTimeout:f=>{const id=++serial;timers.set(id,f);return id;},clearTimeout:id=>timers.delete(id)};
 const make=(text,rect={left:10,top:10,bottom:30})=>{const n={dataset:{tip:text},attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},closest(){return this;},getBoundingClientRect:()=>rect};nodes.push(n);return n;};
 installTooltip(panel,env);
 return{handlers,global,tip,timers,make,panel,env,tick(){const pending=[...timers.values()];timers.clear();for(const f of pending)f();}};
}

assert.equal(TOOLTIP_GRACE_MS,120);
const h=harness(),{handlers:e,tip}=h,a=h.make('source A'),b=h.make('source B');
assert.equal(tip.attrs.role,'tooltip');assert.equal(tip.tabIndex,-1);const stableId=tip.id;

e.pointerover({target:a,relatedTarget:null});
assert(!tip.hidden,'pointer shows immediately');assert.equal(a.attrs['aria-describedby'],stableId);assert.equal(tip.style.pointerEvents,'auto');
e.pointerout({target:a,relatedTarget:b});e.pointerover({target:b,relatedTarget:a});assert.equal(tip.textContent,'source B');assert(!a.attrs['aria-describedby']);assert.equal(b.attrs['aria-describedby'],stableId);
e.pointerout({target:b,relatedTarget:a});e.pointerover({target:a,relatedTarget:b});assert.equal(tip.textContent,'source A');
e.pointerout({target:a,relatedTarget:null});assert(!tip.hidden);assert.equal(h.timers.size,1,'grace is used only across the pointer gap');
e.pointerover({target:tip,relatedTarget:null});assert(!tip.hidden);assert.equal(a.attrs['aria-describedby'],stableId);assert.equal(h.timers.size,0,'popup hover cancels grace');
e.pointerout({target:tip,relatedTarget:null});assert(!tip.hidden);h.tick();assert(tip.hidden);assert(!a.attrs['aria-describedby']);

e.focusin({target:a});assert(!tip.hidden,'focus shows immediately');
e.pointerover({target:a,relatedTarget:null});e.pointerout({target:a,relatedTarget:null});h.tick();assert(!tip.hidden,'focus keeps popup visible');
e.keydown({key:'Escape'});assert(tip.hidden);assert(!a.attrs['aria-describedby']);
e.pointerover({target:a,relatedTarget:null});assert(tip.hidden,'Escape suppresses the same active source');
e.pointerout({target:a,relatedTarget:null});h.tick();assert(tip.hidden,'focus still keeps Escape suppression active');
e.focusout({target:a,relatedTarget:null});e.focusin({target:a});assert(!tip.hidden,'complete leave and blur resets Escape suppression');assert.equal(tip.id,stableId);

e.focusout({target:a,relatedTarget:b});assert.equal(tip.textContent,'source B');assert(!a.attrs['aria-describedby']);assert.equal(b.attrs['aria-describedby'],stableId);
e.focusout({target:b,relatedTarget:null});assert(tip.hidden);

const edge=harness(),owner=edge.make('long text',{left:290,top:220,bottom:235});edge.handlers.pointerover({target:owner,relatedTarget:null});
assert.equal(edge.tip.style.maxWidth,'304px');assert.equal(edge.tip.style.maxHeight,'208px');assert.equal(edge.tip.style.left,'112px');assert.equal(edge.tip.style.top,'116px','tooltip falls back above near the lower edge');
const narrow=harness({width:100,height:80}),narrowOwner=narrow.make('narrow',{left:90,top:10,bottom:25});narrow.handlers.pointerover({target:narrowOwner,relatedTarget:null});assert.equal(narrow.tip.style.maxWidth,'84px');assert.equal(narrow.tip.style.left,'8px');

const second=installTooltip(h.panel,h.env);assert.equal(second.tip,tip);assert.equal(tip.id,stableId,'repeat install preserves stable tooltip ID');

const css=fs.readFileSync(new URL('refinements.css',import.meta.url),'utf8');
assert(css.includes('max-width:min(330px,calc(100vw - 16px))'));assert(css.includes('max-height:calc(100vh - 16px)'));assert(css.includes('pointer-events:auto'));assert(css.includes('overflow:auto'));
const html=fs.readFileSync(new URL('01-monograms.html',import.meta.url),'utf8');
assert.equal((html.match(/<div class="tooltip" role="tooltip" hidden><\/div>/g)||[]).length,4,'popup has no interactive children');
for(const match of html.matchAll(/<p class="dialogue"([^>]*)>([^<]+)<\/p>/g)){assert(!/tabindex/.test(match[1]));assert.equal(match[1],` data-tip="${match[2]}"`);}

console.log('PASS accessible tooltips: immediate pointer/focus, popup hover, crossing grace, Escape lifecycle, stable ARIA, viewport fit/above fallback, bounded long text, passive dialogue names. No browser rendering asserted.');

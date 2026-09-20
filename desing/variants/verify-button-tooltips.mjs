import fs from 'node:fs';
import assert from 'node:assert/strict';import{createRequire}from'node:module';
const{installTooltip}=createRequire(import.meta.url)('./interaction.cjs');
function harness(){
 const handlers={},global={},timers=new Map();let serial=0;const nodes=[];
 const tip={hidden:true,style:{},offsetWidth:120,offsetHeight:50,getBoundingClientRect:()=>({left:5,top:5,right:125,bottom:55}),contains:n=>n===tip};
 const panel={querySelector:()=>tip,contains:n=>nodes.includes(n)||n===tip,addEventListener:(k,f)=>handlers[k]=f};
 const env={innerWidth:320,innerHeight:260,addEventListener:(k,f)=>global[k]=f,setTimeout:f=>{timers.set(++serial,f);return serial;},clearTimeout:k=>timers.delete(k)};
 const make=(text,kind)=>{const n={dataset:{tip:text,tipKind:kind},attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},closest(){return this;},getBoundingClientRect:()=>({left:10,bottom:20}),focus(){}};nodes.push(n);return n;};
 installTooltip(panel,env);return{handlers,global,tip,timers,make,panel,env,tick(){for(const f of [...timers.values()])f();timers.clear();}};
}
for(const kind of ['button','instant',undefined]){
 const h=harness(),{handlers:e,tip}=h,a=h.make('source A',kind),b=h.make('source B',kind);
 assert.equal(e.focusin,undefined);assert.equal(e.focusout,undefined);e.keydown({key:'Tab'});assert(tip.hidden);
 e.pointerover({target:a});assert(!tip.hidden);assert.equal(tip.style.pointerEvents,'none');assert.equal(tip.tabIndex,-1);
 e.pointerout({target:a,relatedTarget:tip});assert(tip.hidden);assert(!a.attrs['aria-describedby']);assert.equal(h.timers.size,0);
 e.pointerover({target:a});e.pointerout({target:a,relatedTarget:b});assert.equal(tip.textContent,'source B');assert(!a.attrs['aria-describedby']);assert.equal(h.timers.size,0);
 e.keydown({key:'Escape'});assert(tip.hidden);e.pointerover({target:b});assert(tip.hidden);e.pointerout({target:b,relatedTarget:null});e.pointerover({target:a});assert(!tip.hidden);
 const foreign=harness().make('foreign');e.pointerout({target:a,relatedTarget:foreign});assert(tip.hidden);
 const child=()=>({closest:()=>a});const kids=Array.from({length:6},child);let writes=0;Object.defineProperty(tip,'textContent',{get(){return this.text;},set(v){this.text=v;writes++;}});
 e.pointerover({target:kids[0]});const before=writes;for(let i=1;i<6;i++){e.pointerout({target:kids[i-1],relatedTarget:kids[i]});e.pointerover({target:kids[i],relatedTarget:kids[i-1]});assert(!tip.hidden);assert.equal(writes,before);assert.equal(h.timers.size,0);}
}
const styles=fs.readFileSync(new URL('refinements.css',import.meta.url),'utf8');assert(styles.includes('width:max-content;max-width:330px'));assert(styles.includes('height:auto;max-height:none;overflow:visible'));assert(!styles.includes('100vw'));
console.log('PASS all tooltips: source-hover only, immediate leave, pointer-pass-through, no timers/Tabstop/focus handlers, stable descendants, Escape and cross-panel ownership; no interactive scroll or viewport fit. No browser rendering asserted.');

const hit=harness(),owner=hit.make('overlay source'),child={closest:()=>owner};hit.handlers.pointerover({target:owner});
hit.global.pointermove({target:owner,clientX:20,clientY:20});assert(hit.tip.hidden);assert(!owner.attrs['aria-describedby']);assert.equal(hit.tip.style.pointerEvents,'none');
hit.handlers.pointerover({target:owner});assert(hit.tip.hidden,'same owner must remain dismissed');
hit.handlers.pointerout({target:owner,relatedTarget:child});hit.handlers.pointerover({target:child,relatedTarget:owner});assert(hit.tip.hidden);
hit.handlers.pointerout({target:child,relatedTarget:null});hit.handlers.pointerover({target:owner});assert(!hit.tip.hidden,'real leave and reentry restores');
hit.global.pointermove({target:owner,clientX:126,clientY:20});assert(!hit.tip.hidden,'outside rectangle does not dismiss');
hit.global.pointermove({target:owner,clientX:125,clientY:55});assert(hit.tip.hidden,'rectangle edge is included');
const peer=harness(),peerOwner=peer.make('peer');peer.handlers.pointerover({target:peerOwner});assert(!peer.tip.hidden,'dismissal is panel-local');
console.log('PASS geometry hit: same-event hide through underlying owner, no child reappearance, reentry reset, rectangle edges, panel-local dismissal.');

const same=hit.global.pointermove;installTooltip(hit.panel,hit.env);assert.equal(hit.global.pointermove,same,'repeat install keeps listener');
const second=harness();installTooltip({querySelector:()=>second.tip,contains:()=>false,addEventListener(){}},hit.env);assert.equal(hit.global.pointermove,same,'second panel shares global listener');

import assert from 'node:assert/strict';import{createRequire}from'node:module';
const{installTooltip}=createRequire(import.meta.url)('./interaction.cjs');
function harness(){
 const handlers={},global={},timers=new Map();let serial=0;const nodes=[];
 const tip={hidden:true,style:{},offsetWidth:120,offsetHeight:50,contains:n=>n===tip};
 const panel={querySelector:()=>tip,contains:n=>nodes.includes(n)||n===tip,addEventListener:(k,f)=>handlers[k]=f};
 const env={innerWidth:320,innerHeight:260,addEventListener:(k,f)=>global[k]=f,setTimeout:f=>{timers.set(++serial,f);return serial;},clearTimeout:k=>timers.delete(k)};
 const make=(text,kind)=>{const n={dataset:{tip:text,tipKind:kind},attrs:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},closest(){return this;},getBoundingClientRect:()=>({left:10,bottom:20}),focus(){}};nodes.push(n);return n;};
 installTooltip(panel,env);return{handlers,global,tip,timers,make,tick(){for(const f of [...timers.values()])f();timers.clear();}};
}
const h=harness(),{handlers:e,global:g,tip}=h,a=h.make('action A','button'),b=h.make('action B','button'),long=h.make('long path');
e.pointerover({target:a});assert(!tip.hidden);assert.equal(tip.style.pointerEvents,'none');assert.equal(tip.tabIndex,-1);
e.pointerout({target:a,relatedTarget:tip});assert(tip.hidden);assert(!a.attrs['aria-describedby']);assert.equal(h.timers.size,0);
e.pointerover({target:b});assert.equal(tip.textContent,'action B');e.pointerout({target:b,relatedTarget:null});assert(tip.hidden);
g.pointerdown({target:a});e.pointerover({target:a});e.focusin({target:a});e.pointerout({target:a,relatedTarget:null});assert(tip.hidden,'click focus does not pin');
g.keydown({key:'Tab'});e.focusin({target:a});e.pointerover({target:a});e.pointerout({target:a,relatedTarget:null});assert(!tip.hidden,'keyboard focus pins');
e.keydown({key:'Escape'});assert(tip.hidden);assert(!a.attrs['aria-describedby']);h.tick();assert(tip.hidden);
e.focusout({relatedTarget:b});e.focusin({target:b});assert(!tip.hidden);assert.equal(tip.textContent,'action B');assert.equal(tip.style.pointerEvents,'none');
e.focusout({relatedTarget:null});e.pointerover({target:long});assert.equal(tip.tabIndex,0);assert.equal(tip.style.pointerEvents,'auto');
e.pointerout({target:long,relatedTarget:tip});e.pointerover({target:tip});h.tick();assert(!tip.hidden,'long remains hoverable');
e.pointerout({target:tip,relatedTarget:a});e.pointerover({target:a});assert.equal(tip.tabIndex,-1);assert.equal(tip.style.pointerEvents,'none');assert(!long.attrs['aria-describedby']);
const other=harness(),foreign=other.make('other','button');e.pointerout({target:a,relatedTarget:foreign});assert(tip.hidden);other.handlers.pointerover({target:foreign});assert(!other.tip.hidden);
console.log('PASS button tooltip handlers: immediate leave, transparent hit testing declaration, no popup Tabstop, pointer-vs-keyboard focus, Escape, next owner, long hover/scroll mode and cross-panel ownership. No browser rendering asserted.');

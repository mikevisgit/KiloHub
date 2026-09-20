import assert from 'node:assert/strict';import fs from 'node:fs';import{createRequire}from'node:module';import vm from 'node:vm';
const C=createRequire(import.meta.url)('./folder-colors.cjs');
assert.equal(C.hues.length,16);assert.equal(new Set(C.hues).size,16);
for(const p of ['D:/Примеры/Папка/','d:\\ПРИМЕРЫ\\папка','D:\\Примеры\\.\\Папка','D:\\Примеры\\другая\\..\\Папка'])assert.equal(C.group(p),C.group('D:\\Примеры\\Папка'));
for(const p of ['',null,'relative','D:relative','D:\\..\\x','\\\\server\\share','D:\\bad?','D:\\folder.'])assert.equal(C.group(p),null);
let minText=99,minBorder=99;
for(let r=0;r<=255;r+=17)for(let g=0;g<=255;g+=17)for(let b=0;b<=255;b+=17)for(let slot=0;slot<16;slot++){
 const surface=[r,g,b],p=C.palette(slot,surface);minText=Math.min(minText,C.contrast(p.fg,p.bg));minBorder=Math.min(minBorder,C.contrast(p.border,surface));assert(C.contrast(p.fg,p.bg)>=4.5);assert(C.contrast(p.border,surface)>=3);
}
let reference=null,panels=0;
for(const file of ['01-monograms.html','vscode-monograms/02-inset.html']){
 const html=fs.readFileSync(new URL(file,import.meta.url),'utf8');
 for(const panel of html.split('<section class="panel ').slice(1)){
  if(panel.startsWith('monograms demo-original')){const original=panel.split('</section>')[0];assert.equal((original.match(/class="mono"/g)||[]).length,16);assert(!original.includes('data-color-group'));for(const tone of ['mint','peach','lavender','blue','gray'])assert(original.includes('folder '+tone));continue;}
  const entries=[...panel.split('</section>')[0].matchAll(/data-path="([^"]+)"[\s\S]*?data-color-group="(\d+)"/g)].map(m=>[m[1],Number(m[2])]);
  assert.equal(entries.length,16);assert.equal(new Set(entries.map(x=>x[1])).size,16);
  for(const [path,slot]of entries)assert.equal(C.group(path),slot);
  reference??=entries;assert.deepEqual(entries,reference);panels++;
 }
}
assert.equal(panels,6);
const runtime=fs.readFileSync(new URL('folder-colors.js',import.meta.url),'utf8');assert(runtime.includes('MutationObserver'));assert(runtime.includes('resolveSurface(panel)'));
// Реальный обработчик смены темы на офлайн DOM-дубле: не заменяет браузер.
let refresh;const events={};const panel={background:'rgb(37, 37, 38)',parentElement:null};
const rows=reference.map(([path])=>{const properties={};const head={background:'rgba(0, 0, 0, 0)',parentElement:panel};const mark={parentElement:head,dataset:{},style:{setProperty:(k,v)=>properties[k]=v,removeProperty:k=>delete properties[k]}};return{dataset:{path},mark,properties,querySelector:()=>mark};});
panel.querySelectorAll=()=>rows;
vm.runInNewContext(runtime,{HubColors:C,document:{querySelectorAll:()=>[panel],documentElement:{}},getComputedStyle:e=>({backgroundColor:e.background}),MutationObserver:class{constructor(cb){refresh=cb;}observe(){}},requestAnimationFrame:cb=>cb(),matchMedia:()=>({addEventListener(){}}),window:{addEventListener:(type,cb)=>events[type]=cb}});
const before=rows.map(r=>r.mark.dataset.colorGroup);
for(const surface of ['rgb(255, 255, 255)','rgb(0, 0, 0)','rgb(250, 250, 240)','color(display-p3 1 1 1)']){panel.background=surface;refresh([{target:panel}]);assert.deepEqual(rows.map(r=>r.mark.dataset.colorGroup),before);assert(rows.every(r=>r.properties['--folder-bg']));}
assert(rows.every(r=>r.properties['--folder-bg']==='Canvas'));
panel.background='rgb(37, 37, 38)';events.focus();const backgrounds=rows.map(r=>r.properties['--folder-bg']);rows.reverse();refresh([{target:panel}]);assert.deepEqual(rows.map(r=>r.properties['--folder-bg']),backgrounds.reverse());
console.log(`PASS colors:96 adaptive marks,16 groups per themed panel; original16 legacy pastel marks; path equivalents; RGB4096×16 contrast min text ${minText.toFixed(2)}, border ${minBorder.toFixed(2)}. Source/algorithm only, not browser theme rendering.`);

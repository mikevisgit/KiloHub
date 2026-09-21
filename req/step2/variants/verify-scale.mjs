import fs from 'node:fs';import assert from 'node:assert/strict';
const read=f=>fs.readFileSync(new URL(f,import.meta.url),'utf8'),css=read('scale.css'),compact=css.replace(/\s+/g,'');
assert(compact.includes('--hub-base:var(--vscode-font-size,13px)'));assert(compact.includes('var(--vscode-font-family'));assert(compact.includes('var(--vscode-font-weight,400)'));
for(const body of [read('panel.css').split('.panel{')[1],read('refinements.css'),css])assert(!/font-size\s*:\s*\d/.test(body),'No fixed product font sizes');
for(const [file,themes]of [['01-monograms.html',4]]){const html=read(file);assert.equal((html.match(/class="panel /g)||[]).length,themes);assert(html.indexOf('scale.css')>html.indexOf('refinements.css'));}
const baseBlock=compact.match(/\.panel\{(.*?)\}/)[1];
function ratio(block,key){const found=block.match(new RegExp(`--hub-${key}:calc\\(var\\(--hub-base\\)\\*([.\\d]+)\\)`));assert(found,key);return Number(found[1]);}
const mono=Object.fromEntries(['mono-size','row-x','gap','name-size'].map(k=>[k,ratio(baseBlock,k)]));
for(const b of [13,16,20])for(const width of [260,320,400])for(const [name,tokens]of [['monograms',mono]]){
 // Резерв17px под scrollbar — консервативный пример, не измерение пользовательского scrollbar.
 const free=width-2-17-4*tokens['row-x']*b-2-tokens['mono-size']*b-2*tokens.gap*b-b;
 assert(free>tokens['name-size']*b,`${name} ${width}px B${b}: space for a glyph`);
 if(width===260)console.log(`${name}: width260 B${b}, name area≈${free.toFixed(1)}px, name font≈${(tokens['name-size']*b).toFixed(1)}px`);
}
assert(compact.includes('white-space:nowrap;overflow:hidden;text-overflow:ellipsis'));assert(compact.includes('overflow-wrap:anywhere'));assert(!/font-size[^}]+@media/.test(css));
console.log('PASS scale: 4 themes share UI-font tokens, no fixed product font sizes, widths260/320/400 at B13/16/20. Arithmetic only, no rendered layout asserted.');

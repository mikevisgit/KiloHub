import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{createRequire}from'node:module';import{fileURLToPath}from'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),require=createRequire(import.meta.url),{relative,sortFolders}=require('./activity.cjs');
const now=new Date(2026,8,20,14,35),at=days=>{const d=new Date(now);d.setDate(d.getDate()-days);return d.toISOString();};
for(const [day,want]of [[0,'Сегодня, 14:35'],[1,'Вчера'],[2,'2 дня назад'],[6,'6 дней назад'],[7,'Неделю назад'],[13,'Неделю назад'],[14,'2 недели назад'],[20,'2 недели назад'],[21,'3 недели назад'],[29,'3 недели назад'],[30,'Месяц назад'],[59,'Месяц назад'],[60,'2 месяца назад'],[364,'12 месяцев назад'],[365,'Год назад'],[730,'2 года назад'],[1825,'5 лет назад']])assert.equal(relative(at(day),now),want);
for(const bad of [null,'broken',new Date(+now+1).toISOString()])assert.equal(relative(bad,now),'Дата неизвестна');
assert.equal(relative(new Date(2026,8,19,23,59).toISOString(),new Date(2026,8,20,0,1)),'Вчера');
assert.deepEqual(sortFolders([{id:'a',name:'А',activity:at(0)},{id:'c',name:'В',current:true,activity:at(50)},{id:'b',name:'Б',activity:null}],now).map(x=>x.id),['c','a','b']);
let panels=0;
for(const [file,count]of [['01-monograms.html',4],['vscode-monograms/02-inset.html',3]]){
 const html=fs.readFileSync(path.join(root,file),'utf8');assert.equal((html.match(/class="panel /g)||[]).length,count);panels+=count;
 assert.equal((html.match(/class="history"/g)||[]).length,count*16);assert.equal((html.match(/class="dialogue"/g)||[]).length,count*46);assert.equal((html.match(/aria-disabled="true"/g)||[]).length,0);
 for(const match of html.matchAll(/<article class="folder ([^"]*)"([\s\S]*?)<\/article>/g)){
  const [,classes,body]=match,missing=classes.includes('missing'),current=classes.includes('current');
  assert.equal((body.match(/<button /g)||[]).length,missing?0:current?1:3);
  assert.equal(body.includes('class="actions"'),!missing);
  if(current&&!missing){assert(body.includes('Показать файлы папки'));assert(!body.includes('>Открыть в'));}
  assert(body.includes('class="history"'));assert(body.includes('class="activity"'));
  const head=body.split('<div class="detail-wrap')[0];assert.equal((head.match(/data-tip=/g)||[]).length,1,'one head tooltip owner');assert(head.includes('class="folder-head" data-tip="D:'));assert(!/<span class="(?:name|activity|missing-label)"[^>]*data-tip/.test(head));
 }
 assert.equal((html.match(/aria-expanded="true"/g)||[]).length,count);assert.equal((html.match(/Вы сейчас здесь/g)||[]).length,count);
 for(const forbidden of ['<time','class="path"','class="hint"','<ul','Открыть в новом окне','Ваши папки'])assert(!html.includes(forbidden),forbidden);
 for(const m of html.matchAll(/(?:href|src)="([^"]+)"/g)){const [p,anchor]=m[1].split('#');const dest=path.resolve(path.dirname(path.join(root,file)),decodeURIComponent(p||path.basename(file)));assert(fs.existsSync(dest),dest);if(anchor)assert(fs.readFileSync(dest,'utf8').includes(`id="${anchor}"`));}
}
assert.equal(panels,7);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
assert.equal(walk(root).filter(f=>f.endsWith('.html')).length,3,'Only gallery and two designs');
for(const file of [...walk(root).filter(f=>/\.(html|md)$/.test(f)),path.join(root,'../ТЗ реализации дизайна VSIX.md'),path.join(root,'../design-task-v2.md'),path.join(root,'../UX правки.md')]){
 const body=fs.readFileSync(file,'utf8');const refs=file.endsWith('.html')?[...body.matchAll(/(?:href|src)="([^"]+)"/g)].map(m=>m[1]):[...body.matchAll(/\]\(([^)]+)\)/g)].map(m=>m[1]);
 for(const ref of refs){if(/^https?:/.test(ref))continue;const [p,anchor]=ref.split('#'),dest=p?path.resolve(path.dirname(file),decodeURIComponent(p)):file;assert(fs.existsSync(dest),`${file}: ${ref}`);if(anchor&&dest.endsWith('.html'))assert(fs.readFileSync(dest,'utf8').includes(`id="${anchor}"`));}
}
for(const file of walk(root).filter(f=>/\.(css|html|js|cjs)$/.test(f))){const body=fs.readFileSync(file,'utf8');assert(!/https?:\/\/|fetch\(|XMLHttpRequest|WebSocket/.test(body),'No external requests: '+file);if(file.endsWith('.css')){let braces=0,parens=0;for(const char of body){if(char==='{')braces++;if(char==='}')braces--;if(char==='(')parens++;if(char===')')parens--;assert(braces>=0&&parens>=0,file);}assert.equal(braces,0);assert.equal(parens,0);}}
const css=fs.readFileSync(path.join(root,'demo-themes.css'),'utf8');const lum=hex=>{const rgb=hex.match(/\w\w/g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};
for(const theme of ['original','dark','light','contrast']){const block=css.match(new RegExp(`\\.demo-${theme}\\{([\\s\\S]*?)\\}`))[1];const vars=Object.fromEntries([...block.matchAll(/--vscode-([\w-]+):#([0-9a-f]{6})/g)].map(m=>[m[1],m[2]]));let min=99;for(const [fg,bg]of [['sideBar-foreground','sideBar-background'],['descriptionForeground','sideBar-background'],['button-foreground','button-background'],['button-secondaryForeground','button-secondaryBackground'],['badge-foreground','badge-background'],['list-inactiveSelectionForeground','list-inactiveSelectionBackground'],['editorWarning-foreground','sideBar-background'],['descriptionForeground','list-inactiveSelectionBackground'],['list-hoverForeground','list-hoverBackground'],['button-foreground','button-hoverBackground'],['button-secondaryForeground','button-secondaryHoverBackground']]){const a=lum(vars[fg]),b=lum(vars[bg]),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);min=Math.min(min,ratio);assert(ratio>=4.5,`${theme} ${fg} ${ratio}`);}console.log(`${theme}: minimum text contrast ${min.toFixed(2)}:1`);}
console.log('PASS: 2 concepts, 7 themes; structure, local dependencies, dates and ordering. No browser/runtime rendering asserted.');

assert(!fs.readFileSync(path.join(root,'demo.js'),'utf8').includes('date.dataset.tip'),'activity refresh must not restore date tooltip');

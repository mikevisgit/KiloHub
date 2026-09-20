import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root=path.dirname(fileURLToPath(import.meta.url));
const files=fs.readdirSync(root).filter(f=>f.endsWith('.html'));
assert.equal(files.length,6);
for(const file of files){
 const html=fs.readFileSync(path.join(root,file),'utf8');
 assert(!/<script|https?:\/\/|on(?:click|load)=/.test(html),`${file}: активный или внешний ресурс`);
 for(const m of html.matchAll(/(?:href|src)="([^"]+)"/g)){
  const [name,anchor]=m[1].split('#');const target=path.join(root,name||file);
  assert(fs.existsSync(target),`Нет файла ${target}`);
  if(anchor)assert(fs.readFileSync(target,'utf8').includes(`id="${anchor}"`),`Нет якоря ${anchor}`);
 }
 if(file!=='index.html'){
  for(const theme of ['dark','light','contrast'])assert(html.includes(`id="${theme}"`)&&html.includes(`demo-${theme}`));
  assert.equal([...html.matchAll(/<details /g)].length,15);
  assert.equal([...html.matchAll(/<button disabled/g)].length,9);
  assert.equal([...html.matchAll(/<li>/g)].length,39);
  assert.equal([...html.matchAll(/Текущая папка/g)].length,3);
  for(const list of html.matchAll(/<ul>(.*?)<\/ul>/g)){
   assert([...list[1].matchAll(/<li>/g)].length<=3);
   assert(!/<a |<button/.test(list[1]));
  }
 }
}
const css=fs.readFileSync(path.join(root,'demo-themes.css'),'utf8');
const panel=fs.readFileSync(path.join(root,'panel.css'),'utf8');
const names=[...new Set([...panel.matchAll(/var\((--vscode-[\w-]+)/g)].map(m=>m[1]))].filter(n=>n!=='--vscode-font-family');
function lum(hex){const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
const pairs=[
 ['sideBar-foreground','sideBar-background'],['descriptionForeground','sideBar-background'],
 ['badge-foreground','badge-background'],['list-inactiveSelectionForeground','list-inactiveSelectionBackground'],
 ['list-hoverForeground','list-hoverBackground'],['button-foreground','button-background'],
 ['button-foreground','button-hoverBackground'],['button-secondaryForeground','button-secondaryBackground'],
 ['button-secondaryForeground','button-secondaryHoverBackground'],['editorWarning-foreground','sideBar-background']
];
const report=[];
for(const theme of ['dark','light','contrast']){
 const block=css.match(new RegExp(`\\.demo-${theme}\\{([\\s\\S]*?)\\}`))[1];
 const palette=Object.fromEntries([...block.matchAll(/(--vscode-[\w-]+):([^;]+);/g)].map(m=>[m[1],m[2]]));
 for(const name of names)assert(name in palette,`Нет токена ${name} в ${theme}`);
 let minimum=100;
 for(const [fg,bg] of pairs){const a=lum(palette['--vscode-'+fg]),b=lum(palette['--vscode-'+bg]);const ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);minimum=Math.min(minimum,ratio);assert(ratio>=4.5,`${theme}: ${fg}/${bg}: ${ratio.toFixed(2)}`);}
 report.push(`${theme}: ${names.length} токенов, минимальный контраст проверенных текстовых пар ${minimum.toFixed(2)}:1`);
}
console.log('PASS: 5 концепций x 3 темы; 6 HTML; ссылки и якоря; пассивные диалоги <=3; disabled actions; нет внешних ресурсов/скриптов.');
console.log(report.join('\n'));
console.log('Только структурная проверка и расчёт пар палитры; не браузерный рендер и не проверка всех пользовательских тем VS Code.');

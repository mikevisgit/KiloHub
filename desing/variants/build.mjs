import fs from 'node:fs';
import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
const modes = [
 ['01-monograms','Монограммы','Крупные буквенные знаки и спокойные отдельные карточки.','monograms'],
 ['02-editorial','Крупный текст','Типографика и свободное пространство вместо привычных значков.','editorial'],
 ['03-folders','Папки на столе','Знакомый силуэт папки и видимые цветные вкладки.','folders'],
 ['04-rail','Лента ориентиров','Цветовые направляющие собирают детали вокруг названия.','rail'],
 ['05-mosaic','Мозаика','Крупные плитки; раскрытая папка занимает всю ширину.','mosaic'],
 ['06-notebook','Рабочая тетрадь','Выразительные заголовки на светлой бумаге с чёткими разделителями.','notebook'],
 ['07-focus','Контрастные блоки','Тёмные плашки и крупные геометрические знаки для быстрого узнавания.','focus']
];
const folders = [
 {name:'Сайт мастерской',initials:'СМ',color:'mint',current:true},
 {name:'Семейный бюджет',initials:'СБ',color:'peach',open:true},
 {name:'Путешествие по северу',initials:'ПС',color:'lavender'},
 {name:'Каталог работ и вдохновения для новой коллекции',initials:'КР',color:'blue'},
 {name:'Старый эксперимент',initials:'СЭ',color:'gray',missing:true}
];
const icon = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 7V5a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" stroke="currentColor" stroke-width="1.6"/></svg>';
function detail(f) {
 const titles = f.missing ? ['Первые наброски'] : ['План расходов на осень','Как наглядно сравнить расходы за несколько месяцев','Без названия'];
 return `<div class="detail"><p class="path">D:\\Проекты\\${f.name}</p>${f.missing?'<p class="warning">Папка не найдена. Открытие недоступно; названия диалогов сохранены в истории Kilo.</p>':''}<div class="actions"><button ${f.missing?'disabled':''} title="Макет: заменит папку в текущем окне">Открыть в этом окне <span>↗</span></button><button ${f.missing?'disabled':''}>Открыть в новом окне <span>⊞</span></button><button ${f.missing?'disabled':''}>Показать в проводнике <span>↗</span></button></div><div class="history"><h3>Последние диалоги</h3><p class="hint">Для ориентира · открываются в Kilo</p><ul>${titles.map((x,i)=>`<li><span>${x}</span>${i<2?`<time>${i===0?'Сегодня':'Вчера'}</time>`:''}</li>`).join('')}</ul></div></div>`;
}
function panel(mode, state='normal') {
 if(state!=='normal') {
 const copy={empty:['Здесь появятся ваши папки','После работы с Kilo в локальной папке обновите список.'],loading:['Загружаем папки','Читаем историю Kilo…'],error:['Не удалось загрузить папки','Попробуйте обновить список ещё раз.'],stale:['Не удалось обновить список','Ниже показаны предыдущие данные. Попробуйте обновить ещё раз.'],refreshing:['Обновляем список','Пока показаны предыдущие данные.']}[state];
 return `<section class="panel ${mode}">${header()}<div class="state"><h2>${copy[0]}</h2><p>${copy[1]}</p></div>${['stale','refreshing'].includes(state)?cards(mode):''}</section>`;
 }
 return `<section class="panel ${mode}">${header()}<div class="intro"><h1>Ваши папки</h1><p>Вернитесь к работе в Kilo</p></div>${cards(mode)}</section>`;
}
function header(){return '<header><strong>Kilo Hub</strong><button class="refresh" title="Статический макет ручного обновления">↻ <span>Обновить</span></button></header>';}
function cards(mode){return `<div class="cards">${folders.map((f,i)=>`<details class="folder ${f.color} ${f.current?'current':''} ${f.missing?'missing':''}" ${(f.open || (f.missing&&mode==='rail'))?'open':''}><summary><span class="mark" aria-hidden="true"><span class="letters">${f.initials}</span><span class="folder-icon">${icon}</span><span class="shape"></span></span><span class="identity">${f.current?'<span class="current-label">Вы сейчас здесь</span>':''}<span class="name">${f.name}</span>${f.missing?'<span class="missing-label">Папка не найдена</span>':''}</span><span class="chevron" aria-hidden="true">⌄</span></summary>${detail(f)}</details>`).join('')}</div>`;}
const html=(title,body,css='')=>`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} — Kilo Hub</title><link rel="stylesheet" href="styles.css">${css}</head><body>${body}</body></html>`;
for(const [slug,title,desc,mode] of modes) fs.writeFileSync(path.join(dir,slug+'.html'),html(title,`<div class="review-bar"><a href="index.html">← Все варианты</a><span>${title} · статический макет</span></div><main class="single">${panel(mode)}</main><p class="outside-note">${desc} Кнопки показывают оформление, команды не выполняются.</p>`));
fs.writeFileSync(path.join(dir,'index.html'),html('Семь направлений',`<main class="gallery"><div class="gallery-title"><p>Дизайн Kilo Hub · Step 2</p><h1>Семь способов увидеть<br>свои рабочие папки</h1><p>Одинаковые данные и действия. Разная композиция и визуальный характер.</p><p class="small">Локальные статические макеты. Раскрытие показывает детали; кнопки не открывают папки.<br>Примеры вымышлены. Названия диалогов пассивны.</p><a href="states.html">Состояния и узкая панель →</a></div><div class="gallery-grid">${modes.map(([slug,title,desc,mode],i)=>`<article class="concept"><div class="caption"><span>0${i+1}</span><div><a href="${slug}.html">${title} ↗</a><p>${desc}</p></div></div><iframe src="${slug}.html" title="Вариант ${i+1}: ${title}" loading="lazy"></iframe></article>`).join('')}</div></main>`));
fs.writeFileSync(path.join(dir,'states.html'),html('Состояния',`<div class="review-bar"><a href="index.html">← Все варианты</a><span>Состояния · статические примеры</span></div><main class="state-grid"><article><h2>Узкая панель · 260 px</h2><div class="narrow">${panel('monograms')}</div></article>${['loading','empty','error','stale','refreshing'].map(x=>`<article>${panel('monograms',x)}</article>`).join('')}<article><h2>Недоступная папка</h2>${panel('rail')}</article></main>`));

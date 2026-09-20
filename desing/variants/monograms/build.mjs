import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const baseline = fs.readFileSync(path.join(dir, '../01-monograms.html'), 'utf8');
const concepts = [
 ['01-signature','Большой знак','Увеличенные монограммы слева, широкие интервалы и выразительное название.','signature'],
 ['02-circles','Круги','Мягкие круглые знаки, воздушные карточки и спокойная светлая поверхность.','circles'],
 ['03-banner','Цветная шапка','Название и монограмма собраны на цветном верхнем блоке; детали отделены светлым основанием.','banner'],
 ['04-outline','Контур','Крупная контурная рамка и строгая типографика без декоративного фона.','outline'],
 ['05-margin','Поле слева','Монограмма задаёт отдельную левую колонку, а информация выстраивается вдоль неё.','margin'],
 ['06-centered','По центру','Монограмма над названием: вертикальная композиция с отдельным пространством для каждой папки.','centered'],
 ['07-night','Ночные знаки','Светящиеся цветом буквенные квадраты на тёмных плашках с крупными названиями.','night'],
 ['08-ticket','Билеты','Буквенный корешок, ясное разделение названия и деталей, плотный список.','ticket'],
 ['09-duet','Два масштаба','Большая монограмма и компактный текстовый блок создают асимметричную композицию.','duet'],
 ['10-label','Ярлыки','Небольшая буквенная вкладка над крупным названием; папка читается как самостоятельная обложка.','label']
];
for (const [slug,title,description,mode] of concepts) {
 const html = baseline
  .replace('<title>Монограммы — Kilo Hub</title>',`<title>${title} — монограммы Kilo Hub</title>`)
  .replace('href="styles.css"','href="../styles.css"><link rel="stylesheet" href="monograms.css"')
  .replace('class="panel monograms"',`class="panel monograms ${mode}"`)
  .replace('← Все варианты','← Десять монограмм')
  .replace('Монограммы · статический макет',`${title} · статический макет`)
  .replace('Крупные буквенные знаки и спокойные отдельные карточки.',description);
 fs.writeFileSync(path.join(dir,slug+'.html'),html);
}
fs.writeFileSync(path.join(dir,'index.html'),`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Десять монограмм — Kilo Hub</title><link rel="stylesheet" href="../styles.css"><link rel="stylesheet" href="monograms.css"></head><body><main class="gallery"><div class="gallery-title"><p>Kilo Hub · развитие выбранного направления</p><h1>Монограммы.<br>Десять новых вариантов.</h1><p>Одна идея узнаваемых папок — разные формы, размеры и композиции.</p><p class="small">Только статический дизайн панели. Кнопки не выполняют команды.<br>Раскройте папку, чтобы увидеть три последних диалога и оформление действий.</p><a href="../index.html">← Первые семь концепций</a> · <a href="../01-monograms.html">Исходные монограммы</a></div><div class="gallery-grid">${concepts.map(([slug,title,desc,mode],i)=>`<article class="concept"><div class="caption"><span>${String(i+1).padStart(2,'0')}</span><div><a href="${slug}.html">${title} ↗</a><p>${desc}</p></div></div><iframe src="${slug}.html" title="Монограммы: ${title}" loading="lazy"></iframe></article>`).join('')}</div></main></body></html>`);

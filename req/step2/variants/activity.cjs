(function(root){
 const valid=(v,now)=>{
  if(typeof v!=='string')return null;
  const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(v);if(!m)return null;
  const [y,mo,day,h,min,sec]=m.slice(1,7).map(Number),leap=y%4===0&&(y%100!==0||y%400===0),lengths=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(mo<1||mo>12||day<1||day>lengths[mo-1]||h>23||min>59||sec>59)return null;
  if(m[8]!=='Z'&&(Number(m[8].slice(1,3))>23||Number(m[8].slice(4))>59))return null;
  const d=new Date(v);return Number.isFinite(+d)&&d<=now?d:null;
 };
 const word=(n,a,b,c)=>n%100>=11&&n%100<=14?c:n%10===1?a:n%10>=2&&n%10<=4?b:c;
 function relative(v,now=new Date()){
  const d=valid(v,now);if(!d)return 'Дата неизвестна';
  const calendar=x=>Date.UTC(x.getFullYear(),x.getMonth(),x.getDate())/86400000;
  const days=calendar(now)-calendar(d);
  if(!days)return `Сегодня, ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  if(days===1)return 'Вчера';if(days<7)return `${days} ${word(days,'день','дня','дней')} назад`;
  if(days<14)return 'Неделю назад';if(days<21)return '2 недели назад';if(days<30)return '3 недели назад';if(days<60)return 'Месяц назад';
  const years=days>=365,n=Math.floor(days/(years?365:30));return years&&n===1?'Год назад':`${n} ${years?word(n,'год','года','лет'):word(n,'месяц','месяца','месяцев')} назад`;
 }
 function sortFolders(items,now=new Date()){return [...items].sort((a,b)=>Number(!!b.current)-Number(!!a.current)||((valid(b.activity,now)?.getTime()??-Infinity)-(valid(a.activity,now)?.getTime()??-Infinity))||a.name.localeCompare(b.name,'ru')||a.id.localeCompare(b.id));}
 const api={relative,sortFolders,valid};if(typeof module!=='undefined')module.exports=api;else root.HubActivity=api;
})(globalThis);

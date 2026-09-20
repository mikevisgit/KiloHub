(function(root){
 const valid=(v,now)=>{if(!v)return null;const d=new Date(v);return Number.isFinite(+d)&&d<=now?d:null;};
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

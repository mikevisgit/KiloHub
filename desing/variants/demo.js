// Только обезличенные локальные данные. Нет команд VS Code и сетевых вызовов.
for(const panel of document.querySelectorAll('.panel')){
 const now=new Date(), rows=[...panel.querySelectorAll('.folder')], container=panel.querySelector('.folders');
 const data=rows.map(row=>{const d=new Date(now);d.setDate(d.getDate()-Number(row.dataset.days));if(row.dataset.days==='0')d.setMinutes(Math.max(0,d.getMinutes()-1));row.dataset.activity=d.toISOString();return {id:row.dataset.id,name:row.dataset.name,activity:d.toISOString(),current:row.classList.contains('current'),row};});
 for(const item of HubActivity.sortFolders(data,now)){
  container.append(item.row);const date=item.row.querySelector('.activity');date.textContent=HubActivity.relative(item.activity,now);date.dataset.tip=`Последняя активность в Kilo: ${new Date(item.activity).toLocaleString('ru-RU')}`;
  const head=item.row.querySelector('.folder-head');head.dataset.tip=item.row.querySelector('.name').dataset.tip;
 }
 let running=false;
 async function toggle(head){
  if(running)return;running=true;
  const anchor=head.getBoundingClientRect().top, opening=head.getAttribute('aria-expanded')!=='true';
  const changes=[];
  for(const row of rows){
   const h=row.querySelector('.folder-head'), wrap=row.querySelector('.detail-wrap');const shouldOpen=h===head&&opening, wasOpen=h.getAttribute('aria-expanded')==='true';if(shouldOpen===wasOpen)continue;
   const start=wrap.getBoundingClientRect().height;h.setAttribute('aria-expanded',String(shouldOpen));row.classList.toggle('expanded',shouldOpen);
   if(!shouldOpen&&wrap.contains(document.activeElement))head.focus({preventScroll:true});
   wrap.inert=!shouldOpen;wrap.setAttribute('aria-hidden',String(!shouldOpen));wrap.classList.toggle('open',shouldOpen);const end=shouldOpen?wrap.scrollHeight:0;
   changes.push({wrap,start,end,shouldOpen});wrap.style.height=`${start}px`;
  }
  const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:160;let started;
  await new Promise(resolve=>{function frame(t){started??=t;const p=duration?Math.min(1,(t-started)/duration):1;const ease=1-(1-p)**3;for(const x of changes)x.wrap.style.height=`${x.start+(x.end-x.start)*ease}px`;
   // Компенсируем только собственную прокручиваемую панель; край списка ограничивает смещение.
   panel.scrollTop+=head.getBoundingClientRect().top-anchor;
   if(p<1)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
  for(const x of changes)x.wrap.style.height=x.shouldOpen?'auto':'0px';
  panel.scrollTop+=head.getBoundingClientRect().top-anchor;
  // Минимальное смещение только если сама выбранная плашка/начало деталей вне окна.
  const bounds=panel.getBoundingClientRect(),r=head.getBoundingClientRect();
  if(r.top<bounds.top)panel.scrollTop+=r.top-bounds.top;
  else if(opening&&r.bottom+40>bounds.bottom)panel.scrollTop+=r.bottom+40-bounds.bottom;
  running=false;
 }
 for(const head of panel.querySelectorAll('.folder-head')){
  head.addEventListener('click',()=>toggle(head));
  head.addEventListener('keydown',e=>{if(e.target===head&&(e.key==='Enter'||e.key===' ')){e.preventDefault();toggle(head);}});
 }
 const tip=panel.querySelector('.tooltip');tip.id=`tooltip-${Math.random().toString(36).slice(2)}`;let owner,timer;
 const hide=()=>{tip.hidden=true;owner?.removeAttribute('aria-describedby');owner=null;};
 function show(el){clearTimeout(timer);owner?.removeAttribute('aria-describedby');owner=el;tip.textContent=el.dataset.tip;tip.hidden=false;el.setAttribute('aria-describedby',tip.id);const r=el.getBoundingClientRect();tip.style.left=`${Math.max(8,Math.min(r.left,innerWidth-tip.offsetWidth-8))}px`;tip.style.top=`${Math.max(8,Math.min(r.bottom+5,innerHeight-tip.offsetHeight-8))}px`;}
 panel.addEventListener('pointerover',e=>{const el=e.target.closest('[data-tip]');if(el)show(el);});
 panel.addEventListener('pointerout',e=>{if(!e.relatedTarget?.closest('.tooltip'))timer=setTimeout(hide,180);});
 tip.addEventListener('pointerenter',()=>clearTimeout(timer));tip.addEventListener('pointerleave',hide);
 panel.addEventListener('focusin',e=>{if(e.target.dataset.tip)show(e.target);});panel.addEventListener('focusout',()=>{timer=setTimeout(hide,100);});
 panel.addEventListener('keydown',e=>{if(e.key==='Escape')hide();});panel.addEventListener('scroll',hide);window.addEventListener('resize',hide);
 for(const button of panel.querySelectorAll('.actions button,.refresh'))button.addEventListener('click',()=>{if(button.getAttribute('aria-disabled')==='true')return;panel.querySelector('.demo-status').textContent='Демонстрация: команда не выполняется.';});
}

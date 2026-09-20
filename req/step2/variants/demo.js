// Только обезличенные локальные данные. Нет команд VS Code и сетевых вызовов.
for(const panel of document.querySelectorAll('.panel')){
 const rows=[...panel.querySelectorAll('.folder')], container=panel.querySelector('.folders');
 const data=rows.map(row=>({id:row.dataset.id,name:row.dataset.name,activity:row.dataset.activity,current:row.classList.contains('current'),row}));
 function updateDates(){const now=new Date(),ordered=HubActivity.sortFolders(data,now);for(const item of ordered){
  const position=[...container.children].indexOf(item.row);const expected=ordered.indexOf(item);if(position!==expected)container.insertBefore(item.row,container.children[expected]||null);
  const date=item.row.querySelector('.activity');date.textContent=HubActivity.relative(item.activity,now);
 }}
 updateDates();let midnightTimer;
 function scheduleDates(){clearTimeout(midnightTimer);updateDates();const n=new Date(),next=new Date(n.getFullYear(),n.getMonth(),n.getDate()+1);midnightTimer=setTimeout(scheduleDates,Math.max(1,+next-+n+20));}
 scheduleDates();window.addEventListener('focus',scheduleDates);document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleDates();});
 let lastHead=panel.querySelector('.folder-head[aria-expanded="true"]');
 async function transition(target){
  const head=target||lastHead;if(!head)return;lastHead=head;
  const anchor=head.getBoundingClientRect().top, opening=!!target;
  const changes=[];
  for(const row of rows){
   const h=row.querySelector('.folder-head'), wrap=row.querySelector('.detail-wrap');const shouldOpen=h===target, wasOpen=h.getAttribute('aria-expanded')==='true';if(shouldOpen===wasOpen)continue;
   const start=wrap.getBoundingClientRect().height;h.setAttribute('aria-expanded',String(shouldOpen));row.classList.toggle('expanded',shouldOpen);
   if(!shouldOpen&&wrap.contains(document.activeElement))head.focus({preventScroll:true});
   wrap.inert=!shouldOpen;wrap.setAttribute('aria-hidden',String(!shouldOpen));wrap.classList.toggle('open',shouldOpen);const end=shouldOpen?wrap.scrollHeight:0;
   changes.push({wrap,start,end,shouldOpen});wrap.style.height=`${start}px`;
  }
  const duration=matchMedia('(prefers-reduced-motion: reduce)').matches?0:HubInteraction.ANIMATION_MS;let started;
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
 }
 const queue=HubInteraction.accordionQueue(lastHead,transition);
 for(const head of panel.querySelectorAll('.folder-head')){
  head.addEventListener('click',()=>queue.request(head));
  head.addEventListener('keydown',e=>{if(e.target===head&&(e.key==='Enter'||e.key===' ')){e.preventDefault();queue.request(head);}});
 }
 HubInteraction.installTooltip(panel);
  for(const button of panel.querySelectorAll('.actions button,.refresh'))button.addEventListener('click',()=>{if(button.getAttribute('aria-disabled')==='true')return;if(button.classList.contains('refresh'))scheduleDates();panel.querySelector('.demo-status').textContent='Демонстрация: команда не выполняется.';});
}

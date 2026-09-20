(function(root){
 const ANIMATION_MS=320;
 // Последнее намерение не теряется, включая повторное нажатие той же папки.
 function accordionQueue(initial,transition){
  let desired=initial,applied=initial,running=false,idle=Promise.resolve();
  return {request(target){desired=desired===target?null:target;if(!running){running=true;idle=(async()=>{try{while(applied!==desired){const next=desired;await transition(next);applied=next;}}finally{running=false;}})();}return idle;},get desired(){return desired;},get idle(){return idle;}};
 }
 function installTooltip(panel,env=root){
  const tip=panel.querySelector('.tooltip');tip.id=`tooltip-${Math.random().toString(36).slice(2)}`;tip.tabIndex=-1;
  let owner=null,hover=null;
  const dismissed=new Set();
  const trigger=node=>{const candidate=node?.closest?.('[data-tip]');return candidate&&panel.contains(candidate)?candidate:null;};
  function hide(){tip.hidden=true;owner?.removeAttribute('aria-describedby');owner=null;}
  function position(){if(!owner||tip.hidden)return;const r=owner.getBoundingClientRect();tip.style.left=`${r.left}px`;tip.style.top=`${r.bottom}px`;}
  function reconcile(){for(const item of dismissed)if(item!==hover)dismissed.delete(item);const next=hover;if(!next||dismissed.has(next)){hide();return;}owner?.removeAttribute('aria-describedby');owner=next;tip.textContent=owner.dataset.tip;tip.style.pointerEvents='none';tip.tabIndex=-1;tip.hidden=false;owner.setAttribute('aria-describedby',tip.id);position();}
  for(const type of ['pointerover','pointerout'])panel.addEventListener(type,e=>{const target=trigger(e.target),related=trigger(e.relatedTarget);if(target&&target===related)return;hover=type==='pointerover'?target:related;reconcile();});
  panel.addEventListener('keydown',e=>{if(e.key==='Escape'){for(const item of [owner,hover])if(item)dismissed.add(item);hide();}});
  panel.addEventListener('scroll',position);env.addEventListener('resize',position);
  return {tip,position};
 }
 const api={ANIMATION_MS,accordionQueue,installTooltip};if(typeof module!=='undefined')module.exports=api;else root.HubInteraction=api;
})(globalThis);

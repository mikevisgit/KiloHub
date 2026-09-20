(function(root){
 const ANIMATION_MS=320;
 // Последнее намерение не теряется, включая повторное нажатие той же папки.
 function accordionQueue(initial,transition){
  let desired=initial,applied=initial,running=false,idle=Promise.resolve();
  return {request(target){desired=desired===target?null:target;if(!running){running=true;idle=(async()=>{try{while(applied!==desired){const next=desired;await transition(next);applied=next;}}finally{running=false;}})();}return idle;},get desired(){return desired;},get idle(){return idle;}};
 }
 function installTooltip(panel,env=root){
  const tip=panel.querySelector('.tooltip');tip.id=`tooltip-${Math.random().toString(36).slice(2)}`;tip.tabIndex=-1;
  let owner=null,hover=null,onTip=false,timer;
  const simple=node=>node?.dataset?.tipKind==='button';const dismissed=new Set();
  const trigger=node=>{const candidate=node?.closest?.('[data-tip]');return candidate&&panel.contains(candidate)?candidate:null;};
  const isTip=node=>!!node&&(node===tip||tip.contains(node));
  function hide(){tip.hidden=true;owner?.removeAttribute('aria-describedby');owner=null;}
  function position(){if(!owner||tip.hidden)return;const w=env.innerWidth,h=env.innerHeight;tip.style.maxWidth=`${Math.max(1,w-16)}px`;tip.style.maxHeight=`${Math.max(1,h-16)}px`;const r=owner.getBoundingClientRect();tip.style.left=`${Math.max(8,Math.min(r.left,w-tip.offsetWidth-8))}px`;tip.style.top=`${Math.max(8,Math.min(r.bottom,h-tip.offsetHeight-8))}px`;}
  function reconcile(){env.clearTimeout(timer);for(const item of dismissed)if(item!==hover&&!onTip)dismissed.delete(item);const next=onTip?owner:hover;if(!next||dismissed.has(next)){hide();return;}owner?.removeAttribute('aria-describedby');owner=next;tip.textContent=owner.dataset.tip;tip.style.pointerEvents=simple(owner)?'none':'auto';tip.tabIndex=-1;tip.hidden=false;owner.setAttribute('aria-describedby',tip.id);position();}
  panel.addEventListener('pointerover',e=>{onTip=!simple(owner)&&isTip(e.target);if(!onTip)hover=trigger(e.target);reconcile();});
  panel.addEventListener('pointerout',e=>{const immediate=simple(trigger(e.target))||simple(owner);onTip=!immediate&&isTip(e.relatedTarget);hover=onTip?hover:trigger(e.relatedTarget);env.clearTimeout(timer);if(immediate)reconcile();else timer=env.setTimeout(reconcile,120);});
  panel.addEventListener('keydown',e=>{if(e.key==='Escape'){for(const item of [owner,hover])if(item)dismissed.add(item);hide();}});
  panel.addEventListener('scroll',position);env.addEventListener('resize',position);
  return {tip,position};
 }
 const api={ANIMATION_MS,accordionQueue,installTooltip};if(typeof module!=='undefined')module.exports=api;else root.HubInteraction=api;
})(globalThis);

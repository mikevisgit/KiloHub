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
  function position(){if(!owner||tip.hidden)return;const r=owner.getBoundingClientRect();tip.style.left=`${r.left}px`;tip.style.top=`${r.bottom}px`;}
  function reconcile(){env.clearTimeout(timer);for(const item of dismissed)if(item!==hover&&!onTip)dismissed.delete(item);const next=onTip?owner:hover;if(!next||dismissed.has(next)){hide();return;}owner?.removeAttribute('aria-describedby');owner=next;tip.textContent=owner.dataset.tip;tip.style.pointerEvents=simple(owner)?'none':'auto';tip.tabIndex=-1;tip.hidden=false;owner.setAttribute('aria-describedby',tip.id);position();}
  panel.addEventListener('pointerover',e=>{if(trigger(e.target)&&trigger(e.target)===trigger(e.relatedTarget))return;onTip=!simple(owner)&&isTip(e.target);if(!onTip)hover=trigger(e.target);reconcile();});
  panel.addEventListener('pointerout',e=>{if(trigger(e.target)&&trigger(e.target)===trigger(e.relatedTarget))return;const immediate=simple(trigger(e.target))||simple(owner);onTip=!immediate&&isTip(e.relatedTarget);hover=onTip?hover:trigger(e.relatedTarget);env.clearTimeout(timer);if(immediate)reconcile();else timer=env.setTimeout(reconcile,120);});
  panel.addEventListener('keydown',e=>{if(e.key==='Escape'){for(const item of [owner,hover])if(item)dismissed.add(item);hide();}});
  panel.addEventListener('scroll',position);env.addEventListener('resize',position);
  return {tip,position};
 }
 const api={ANIMATION_MS,accordionQueue,installTooltip};if(typeof module!=='undefined')module.exports=api;else root.HubInteraction=api;
})(globalThis);

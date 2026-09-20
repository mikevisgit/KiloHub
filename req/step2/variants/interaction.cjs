(function(root){
 const ANIMATION_MS=320;
 const TOOLTIP_GRACE_MS=120,VIEWPORT_MARGIN=8,TOOLTIP_GAP=4,installed=new WeakMap();
 // Последнее намерение не теряется, включая повторное нажатие той же папки.
 function accordionQueue(initial,transition){
  let desired=initial,applied=initial,running=false,idle=Promise.resolve();
  return {request(target){desired=desired===target?null:target;if(!running){running=true;idle=(async()=>{try{while(applied!==desired){const next=desired;await transition(next);applied=next;}}finally{running=false;}})();}return idle;},get desired(){return desired;},get idle(){return idle;}};
 }
 function installTooltip(panel,env=root){
  if(installed.has(panel))return installed.get(panel);
  const tip=panel.querySelector('.tooltip');tip.id||=`tooltip-${Math.random().toString(36).slice(2)}`;tip.setAttribute?.('role','tooltip');tip.tabIndex=-1;
  let owner=null,pointerOwner=null,focusOwner=null,popupHover=false,hideTimer=null;
  const dismissed=new Set();
  const trigger=node=>{const candidate=node?.closest?.('[data-tip]');return candidate&&panel.contains(candidate)?candidate:null;};
  const overTip=node=>node===tip||tip.contains?.(node);
  function cancelHide(){if(hideTimer!==null){env.clearTimeout(hideTimer);hideTimer=null;}}
  function inactive(item){return item!==pointerOwner&&item!==focusOwner&&!(popupHover&&item===owner);}
  function clearDismissed(){for(const item of dismissed)if(inactive(item))dismissed.delete(item);}
  function hide(){cancelHide();tip.hidden=true;owner?.removeAttribute('aria-describedby');owner=null;clearDismissed();}
  function position(){
   if(!owner||tip.hidden)return;
   const r=owner.getBoundingClientRect(),width=env.innerWidth??env.document?.documentElement?.clientWidth??0,height=env.innerHeight??env.document?.documentElement?.clientHeight??0;
   const maxWidth=Math.max(0,Math.min(330,width-VIEWPORT_MARGIN*2));tip.style.maxWidth=`${maxWidth}px`;
   const measuredWidth=Math.min(tip.offsetWidth||maxWidth,maxWidth),below=Math.max(0,height-r.bottom-TOOLTIP_GAP-VIEWPORT_MARGIN),above=Math.max(0,r.top-TOOLTIP_GAP-VIEWPORT_MARGIN);
   const measuredHeight=tip.offsetHeight||0,useAbove=measuredHeight>below&&above>below,maxHeight=useAbove?above:below;
   tip.style.maxHeight=`${maxHeight}px`;tip.style.left=`${Math.max(VIEWPORT_MARGIN,Math.min(r.left,width-VIEWPORT_MARGIN-measuredWidth))}px`;
   tip.style.top=`${useAbove?Math.max(VIEWPORT_MARGIN,r.top-TOOLTIP_GAP-Math.min(measuredHeight,maxHeight)):r.bottom+TOOLTIP_GAP}px`;
  }
  function show(next){
   cancelHide();clearDismissed();if(!next||dismissed.has(next)){if(owner!==next)hide();return;}
   if(owner!==next){owner?.removeAttribute('aria-describedby');owner=next;tip.textContent=owner.dataset.tip;owner.setAttribute('aria-describedby',tip.id);}
   tip.style.pointerEvents='auto';tip.tabIndex=-1;tip.hidden=false;position();
  }
  function reconcile(){
   clearDismissed();
   if(owner&&!inactive(owner)&&!dismissed.has(owner)){show(owner);return;}
   const next=focusOwner||pointerOwner;if(next&&!dismissed.has(next))show(next);else hide();
  }
  function delayedReconcile(){cancelHide();hideTimer=env.setTimeout(()=>{hideTimer=null;reconcile();},TOOLTIP_GRACE_MS);}
  panel.addEventListener('pointerover',e=>{
   if(overTip(e.target)){popupHover=true;cancelHide();reconcile();return;}
   const next=trigger(e.target),related=trigger(e.relatedTarget);if(next&&next===related)return;
   if(next){pointerOwner=next;show(next);}
  });
  panel.addEventListener('pointerout',e=>{
   if(overTip(e.target)){popupHover=false;const next=trigger(e.relatedTarget);if(next){pointerOwner=next;show(next);}else delayedReconcile();return;}
   const target=trigger(e.target),related=trigger(e.relatedTarget);if(target&&target===related)return;
   if(target===pointerOwner)pointerOwner=related;if(overTip(e.relatedTarget)){popupHover=true;cancelHide();reconcile();return;}
   if(related)show(related);else delayedReconcile();
  });
  panel.addEventListener('focusin',e=>{const next=trigger(e.target);if(next){focusOwner=next;show(next);}});
  panel.addEventListener('focusout',e=>{const target=trigger(e.target),next=trigger(e.relatedTarget);if(target===focusOwner)focusOwner=next;if(next)show(next);else reconcile();});
  panel.addEventListener('keydown',e=>{if(e.key==='Escape'&&owner){dismissed.add(owner);hide();}});
  panel.addEventListener('scroll',position);env.addEventListener('resize',position);
  const result={tip,position};installed.set(panel,result);return result;
 }
 const api={ANIMATION_MS,TOOLTIP_GRACE_MS,accordionQueue,installTooltip};if(typeof module!=='undefined')module.exports=api;else root.HubInteraction=api;
})(globalThis);

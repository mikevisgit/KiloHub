// Цвета знаков зависят от текущей поверхности; идентичность группы — только от пути.
for(const panel of document.querySelectorAll('.panel:not(.demo-original)')){
 function resolveSurface(element){
  const color=getComputedStyle(element).backgroundColor;
  const parent=element.parentElement?resolveSurface(element.parentElement):[37,37,38];
  const values=/^rgba?\(/.test(color)?color.match(/[\d.]+/g)?.map(Number):null;
  if(!values||values.length<3||color.includes('%'))return null;
  const alpha=values.length>3?values[3]:1;
  if(alpha===1)return values.slice(0,3);
  if(!parent)return null;
  return values.slice(0,3).map((v,i)=>Math.round(v*alpha+parent[i]*(1-alpha)));
 }
 function update(){
  for(const row of panel.querySelectorAll('.folder')){
   const mark=row.querySelector('.mono'),slot=HubColors.group(row.dataset.path);
   if(slot===null){mark.style.removeProperty('--folder-bg');mark.style.removeProperty('--folder-fg');mark.style.removeProperty('--folder-border');delete mark.dataset.colorGroup;continue;}
   const surface=resolveSurface(panel),edge=resolveSurface(mark.parentElement);mark.dataset.colorGroup=String(slot);
   if(!surface||!edge){for(const [key,value]of Object.entries({bg:'Canvas',fg:'CanvasText',border:'CanvasText'}))mark.style.setProperty(`--folder-${key}`,value);continue;}
   const colors=HubColors.palette(slot,surface);colors.border=HubColors.palette(slot,edge).border;
   for(const [key,value]of Object.entries(colors))mark.style.setProperty(`--folder-${key}`,HubColors.css(value));
  }
 }
 let scheduled=false;const schedule=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;update();});}};
 new MutationObserver(records=>{if(records.some(r=>!r.target.closest?.('.mono')))schedule();}).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['class','style','data-vscode-theme-kind']});
 for(const query of ['(prefers-color-scheme: dark)','(forced-colors: active)'])matchMedia(query).addEventListener('change',schedule);
 window.addEventListener('focus',schedule);update();
}

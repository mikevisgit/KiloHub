// Локальный общий алгоритм; не читает файловую систему и не хранит реестр цветов.
(function(root){
 const hues=[0,20,38,55,76,100,130,155,175,195,215,235,255,275,300,330];
 function normalize(value){
  if(typeof value!=='string'||/[\x00-\x1f<>"|?*]/.test(value))return null;
  const p=value.replaceAll('/','\\');let base,tail;
  if(/^[a-z]:\\/i.test(p)){base=p.slice(0,3);tail=p.slice(3);}
  else return null; // UNC/namespace/relative не входят в текущий продукт.
  const parts=[];for(const part of tail.split('\\')){if(!part||part==='.')continue;if(part==='..'){if(!parts.length)return null;parts.pop();continue;}if(/[:]|[. ]$/.test(part))return null;parts.push(part);}
  if(/[:]/.test(base.slice(2))&&base[1]!==':')return null;
  return (base+parts.join('\\')).toLowerCase();
 }
 function group(path){const key=normalize(path);if(key===null)return null;let h=2166136261;for(let i=0;i<key.length;i++)h=Math.imul(h^key.charCodeAt(i),16777619)>>>0;return h%16;}
 function lum(rgb){const c=rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return .2126*c[0]+.7152*c[1]+.0722*c[2];}
 function contrast(a,b){const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
 function hsl(h,s,l){s/=100;l/=100;const a=s*Math.min(l,1-l);return[0,8,4].map(n=>{const k=(n+h/30)%12;return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1))));});}
 const black=[0,0,0],white=[255,255,255];
 function readable(bg){return contrast(black,bg)>=contrast(white,bg)?black:white;}
 function palette(slot,surface){const light=lum(surface)>.35;const bg=hsl(hues[slot],light?42:38,light?86:25);return{bg,fg:readable(bg),border:readable(surface)};}
 const css=rgb=>`rgb(${rgb.join(', ')})`;
 const api={hues,normalize,group,lum,contrast,palette,css};
 if(typeof module!=='undefined')module.exports=api;else root.HubColors=api;
})(typeof globalThis!=='undefined'?globalThis:this);

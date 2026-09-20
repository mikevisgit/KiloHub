// Локальный общий алгоритм; не читает файловую систему и не хранит реестр цветов.
(function(root){
 // Фиксированное чередование семейств; порядок папок никогда не зависит от цвета.
 const slotOrder=[1,6,12,9,15,5,2,13,8,0,10,3,14,7,11,4];
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
 const lightFills=['#efd9d9','#f4deca','#eee1ca','#eee8ce','#e5e9d1','#dce8d0','#d3e9d9','#d1e9e1','#d2e8e7','#d5e7ed','#d8e3f1','#dde0f2','#e5ddf5','#eadcf0','#eedbed','#f0dbe4'];
 const black=[0,0,0],white=[255,255,255];
 function readable(bg){return contrast(black,bg)>=contrast(white,bg)?black:white;}
 function palette(slot,surface,highContrast=false,edge=surface){
  slot=slotOrder[slot];
  const light=lum(surface)>.35;
  const bg=light?lightFills[slot].slice(1).match(/../g).map(v=>parseInt(v,16)):hsl(hues[slot],24,28);
  let fg=hsl(hues[slot],28,light?25:90);if(contrast(fg,bg)<4.5)fg=readable(bg);
  return{bg,fg,border:highContrast&&contrast(bg,edge)<3?readable(edge):null};
 }
 const css=rgb=>rgb?`rgb(${rgb.join(', ')})`:'transparent';
 const api={slotOrder,hues,lightFills,normalize,group,lum,contrast,palette,css};
 if(typeof module!=='undefined')module.exports=api;else root.HubColors=api;
})(typeof globalThis!=='undefined'?globalThis:this);

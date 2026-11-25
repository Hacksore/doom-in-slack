import {readFileSync as read} from 'node:fs';
export type Lump={name:string,data:Buffer};
// Conservative first-map dependency closure: preserve all animation and switch sets,
// complete sprite families for map actors, weapons, drops and engine-spawned effects.
export function trimVisuals(lumps:Lump[]){
 const get=(n:string)=>{const l=lumps.find(l=>l.name===n);if(!l)throw Error('Missing '+n);return l.data;};
 const name=(b:Buffer,p:number)=>b.toString('ascii',p,p+8).replace(/\0/g,'');
 const textures=new Set<string>(['SKY1','SKY2','SKY3','SKY4']);const flats=new Set<string>(['F_SKY1','FLOOR4_8']);
 const sides=get('SIDEDEFS');for(let p=0;p<sides.length;p+=30)for(const o of [4,12,20])textures.add(name(sides,p+o));
 const sectors=get('SECTORS');for(let p=0;p<sectors.length;p+=26)for(const o of [4,12])flats.add(name(sectors,p+o));
 const switches=read('.build/doomgeneric/doomgeneric/p_switch.c','utf8').matchAll(/\{"(SW[12][^"]+)"/g);for(const m of switches)textures.add(m[1]);
 // Both names in each pair; the regex above catches only the first field.
 for(const m of read('.build/doomgeneric/doomgeneric/p_switch.c','utf8').matchAll(/"(SW[12][^"]+)"/g))textures.add(m[1]);
 const anims=[...read('.build/doomgeneric/doomgeneric/p_spec.c','utf8').matchAll(/\{(true|false),\s*"([^"]+)",\s*"([^"]+)"/g)];
 const textureLumps=lumps.filter(l=>/^TEXTURE[12]$/.test(l.name));
 const entries=new Map<string,Buffer>();for(const lump of textureLumps){const b=lump.data;for(let i=0;i<b.readInt32LE(0);i++){const p=b.readInt32LE(4+i*4),count=b.readInt16LE(p+20);entries.set(name(b,p),b.subarray(p,p+22+10*count));}}
 const expand=(list:string[],set:Set<string>,isTexture:boolean)=>{for(const a of anims)if((a[1]==='true')===isTexture){const first=list.indexOf(a[3]),last=list.indexOf(a[2]);if(first>=0&&last>=first)for(let i=first;i<=last;i++)set.add(list[i]);}};
 expand([...entries.keys()],textures,true);expand(lumps.map(l=>l.name),flats,false);
 const usedPatches=new Set<number>();const kept=[...entries].filter(([n])=>textures.has(n));
 for(const [,b] of kept)for(let i=0;i<b.readInt16LE(20);i++)usedPatches.add(b.readUInt16LE(22+i*10+4));
 const pnames=get('PNAMES');const patchNames=new Set([...usedPatches].map(i=>name(pnames,4+i*8)));
 const directory=Buffer.alloc(4+kept.length*4);directory.writeInt32LE(kept.length,0);let off=directory.length;kept.forEach(([,b],i)=>{directory.writeInt32LE(off,4+i*4);off+=b.length;});const texture=Buffer.concat([directory,...kept.map(([,b])=>b)]);
 const things=get('THINGS'),types=new Set<number>();for(let p=0;p<things.length;p+=10)types.add(things.readUInt16LE(p+6));
 const info=read('.build/doomgeneric/doomgeneric/info.c','utf8');const roots=new Set<string>();
 for(const m of info.matchAll(/\{\s*\/\/ (MT_\w+)\s+([\s\S]*?)\n\s*\}/g)){const number=Number(m[2].match(/(-?\d+),\s*\/\/ doomednum/)?.[1]);if(number===-1||types.has(number)||['MT_CLIP','MT_SHOTGUN','MT_CHAINGUN'].includes(m[1]))for(const s of m[2].matchAll(/\bS_\w+/g))roots.add(s[0]);}
 const states=new Map<string,{sprite:string,next:string}>();for(const m of info.matchAll(/\{SPR_(\w+),[^\n]+?\},(S_\w+),[^\n]+?\/\/ (S_\w+)/g))states.set(m[3],{sprite:m[1],next:m[2]});
 if(states.size<900)throw Error('State parser failed');
 // All first-person weapon animations (including weapons acquired through cheat codes).
 const weaponSprites=info.slice(info.indexOf('char *sprnames'),info.indexOf('NULL')).match(/"\w+"/g)!.slice(0,16).map(s=>s.slice(1,-1));
 const sprites=new Set(weaponSprites);const seen=new Set<string>();const visit=(s:string)=>{if(seen.has(s))return;seen.add(s);const st=states.get(s);if(st){sprites.add(st.sprite);visit(st.next);}};for(const s of roots)visit(s);
 let section='';const result:Lump[]=[];
 for(const l of lumps){if(/^[SPF]_START$/.test(l.name))section=l.name[0];
 let keep=true;if(section==='S'&&!/^S_/.test(l.name))keep=sprites.has(l.name.slice(0,4));
 if(section==='P'&&!/^P\d?_/.test(l.name))keep=patchNames.has(l.name);
 if(section==='F'&&!/^F\d?_/.test(l.name))keep=flats.has(l.name);
 if(l.name==='TEXTURE1'){result.push({name:l.name,data:texture});continue;}if(l.name==='TEXTURE2')continue;
 // Preserve menu/help/title and intermission assets; no finale is reachable.
 if(/^(VICTORY2|ENDPIC|BOSSBACK|PFUB[12]|END[0-6])$/.test(l.name))keep=false;
 if(keep)result.push(l);if(/^[SPF]_END$/.test(l.name))section='';
 }
 return {lumps:result,stats:{textures:kept.length,spriteFamilies:sprites.size,mapTypes:[...types].sort((a,b)=>a-b)}};
}

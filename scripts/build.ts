import {readFileSync as read,writeFileSync as write,mkdirSync,existsSync,copyFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {minify} from 'terser';
import {trimVisuals} from './trim-wad.ts';
const root=resolve(import.meta.dirname,'..');process.chdir(root);
function run(cmd:string,args:string[],cwd=root){const r=spawnSync(cmd,args,{cwd,stdio:'inherit'});if(r.status!==0)throw Error(`${cmd} failed (${r.status})`);}
mkdirSync('.build',{recursive:true});mkdirSync('licenses',{recursive:true});
mkdirSync('dist',{recursive:true});
const doomRev='e257a09527062bfb986b6e5e0780839b6cbd5b71';
if(!existsSync('.build/doomgeneric/doomgeneric/Makefile')){run('git',['clone','https://github.com/ozkl/doomgeneric.git','.build/doomgeneric']);run('git',['checkout',doomRev],resolve('.build/doomgeneric'));}
const actual=existsSync('.build/doomgeneric/.git')?spawnSync('git',['rev-parse','HEAD'],{cwd:'.build/doomgeneric',encoding:'utf8'}).stdout.trim():read('.build/doomgeneric/REVISION','utf8').trim();if(actual!==doomRev)throw Error('Unexpected doomgeneric revision');write('.build/doomgeneric/REVISION',doomRev+'\n');
if(!existsSync('.build/freedoom.zip'))run('curl',['-fL','https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip','-o','.build/freedoom.zip']);
if(createHash('sha256').update(read('.build/freedoom.zip')).digest('hex')!=='3f9b264f3e3ce503b4fb7f6bdcb1f419d93c7b546f4df3e874dd878db9688f59')throw Error('Freedoom checksum mismatch');
run('unzip',['-oq','.build/freedoom.zip','freedoom-0.13.0/freedoom1.wad','freedoom-0.13.0/COPYING.txt','freedoom-0.13.0/CREDITS.txt','-d','.build']);
copyFileSync('.build/freedoom-0.13.0/COPYING.txt','licenses/Freedoom.txt');copyFileSync('.build/freedoom-0.13.0/CREDITS.txt','licenses/Freedoom-CREDITS.txt');copyFileSync('.build/doomgeneric/LICENSE','licenses/DOOM.txt');
// Keep the first map and all visual assets. Drop audio, demos, and other maps.
const original=read('.build/freedoom-0.13.0/freedoom1.wad');
type Lump={name:string,data:Buffer};let lumps:Lump[]=[];let map='';
for(let i=0;i<original.readInt32LE(4);i++){const p=original.readInt32LE(8)+i*16;const start=original.readInt32LE(p),size=original.readInt32LE(p+4),name=original.toString('ascii',p+8,p+16).replace(/\0/g,'');
 if(/^E\dM\d$/.test(name))map=name;
 else if(!['THINGS','LINEDEFS','SIDEDEFS','VERTEXES','SEGS','SSECTORS','NODES','SECTORS','REJECT','BLOCKMAP'].includes(name))map='';
 if(map&&map!=='E1M1'||/^(DS|DP|DEMO)/.test(name))continue;
 lumps.push({name,data:original.subarray(start,start+size)});
}
function wad(items:Lump[]){let offset=12;const dir=Buffer.alloc(items.length*16);items.forEach((l,i)=>{dir.writeInt32LE(offset,i*16);dir.writeInt32LE(l.data.length,i*16+4);dir.write(l.name,i*16+8,8,'ascii');offset+=l.data.length;});const head=Buffer.alloc(12);head.write('IWAD');head.writeInt32LE(items.length,4);head.writeInt32LE(offset,8);return Buffer.concat([head,...items.map(l=>l.data),dir]);}
const conservative=wad(lumps);const trimmed=trimVisuals(lumps);lumps=trimmed.lumps;
const game=wad(lumps);write('.build/doom1.wad',game);
const make=read('.build/doomgeneric/doomgeneric/Makefile','utf8');const sources=make.match(/SRC_DOOM = (.*)/)![1].trim().split(/\s+/).filter(x=>x!=='doomgeneric_xlib.o').map(x=>resolve('.build/doomgeneric/doomgeneric',x.replace(/\.o$/,'.c')));
// This one-map POC always restarts E1M1 after intermission or New Game.
let gameSource=read('.build/doomgeneric/doomgeneric/g_game.c','utf8');
for(const [from,to] of [['gamemap = wminfo.next+1;','gamemap = 1; gameepisode = 1;'],['gamemap = map;','gamemap = 1; gameepisode = 1;']]){if(!gameSource.includes(from))throw Error('Upstream map patch no longer applies');gameSource=gameSource.replace(from,to);}
write('.build/g_game.c',gameSource);sources[sources.findIndex(s=>s.endsWith('/g_game.c'))]=resolve('.build/g_game.c');
const emcc=process.env.EMCC||resolve('.build/emsdk/upstream/emscripten/emcc');
run(emcc,[...sources,resolve('src/platform.c'),'-I'+resolve('.build/doomgeneric/doomgeneric'),'-Oz','-flto','-DNORMALUNIX','-DLINUX','-D_DEFAULT_SOURCE','-DDOOMGENERIC_RESX=320','-DDOOMGENERIC_RESY=200','-sENVIRONMENT=web','-sDYNAMIC_EXECUTION=0','-sMODULARIZE=1','-sEXPORT_NAME=createDoom','-sFILESYSTEM=1','-sFORCE_FILESYSTEM=1','-sEXPORTED_RUNTIME_METHODS=["FS","callMain"]','-sEXPORTED_FUNCTIONS=["_main","_key_event","_player_x","_player_y"]','-sINVOKE_RUN=0','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=33554432','-sASYNCIFY=1','-sASSERTIONS=0','-sEXIT_RUNTIME=0','-o',resolve('.build/engine.js')]);
const runtime=read('.build/engine.js','utf8');if(/\beval\s*\(|new Function\s*\(/.test(runtime))throw Error('Dynamic execution in generated runtime');
const sizes:Record<string,unknown>={originalWad:original.length,conservativeWad:{raw:conservative.length,gzip:gzipSync(conservative,{level:9}).length},trim:trimmed.stats};
function payload(name:string,bytes:Buffer){const gz=gzipSync(bytes,{level:9});const b64=gz.toString('base64');sizes[name]={raw:bytes.length,gzip:gz.length,base64:Buffer.byteLength(b64)};return b64;}
const wasm=payload('wasm',read('.build/engine.wasm')),data=payload('wad',game);
const notices=['DOOM engine (GPL-2.0-or-later), doomgeneric revision '+doomRev,read('licenses/DOOM.txt','utf8'),read('licenses/Freedoom.txt','utf8'),read('licenses/Freedoom-CREDITS.txt','utf8')].join('\n\n');
let html=read('src/shell.html','utf8').replace('<link rel="stylesheet" href="/src/doom.css">',()=>'<style>'+read('src/doom.css','utf8').trim()+'</style>').replace('/*ENGINE*/',runtime).replace('__WASM__',wasm).replace('__WAD__',data).replace('__NOTICES__',notices.replace(/&/g,'&amp;').replace(/</g,'&lt;'));
const script=html.match(/<script>([\s\S]*?)<\/script>/)![1];
const minified=await minify(script,{compress:true,mangle:true,format:{comments:false,inline_script:true}});if(!minified.code)throw Error('Minification failed');
html=html.replace(/<script>[\s\S]*?<\/script>/,()=>'<script>'+minified.code+'</script>');
html=html.replace(/\n\s*/g,'\n');write('dist/doom.html',html);sizes.runtime={raw:Buffer.byteLength(runtime),gzip:gzipSync(runtime,{level:9}).length};sizes.finalHtml=Buffer.byteLength(html);sizes.finalHtmlGzip=gzipSync(html,{level:9}).length;sizes.sha256=createHash('sha256').update(html).digest('hex');write('dist/sizes.json',JSON.stringify(sizes,null,2)+'\n');console.log(JSON.stringify(sizes,null,2));
let probe=read('src/test.html','utf8');const probeCode=probe.match(/<script>([\s\S]*?)<\/script>/)![1];const probeMin=await minify(probeCode,{compress:true,mangle:true,format:{comments:false,inline_script:true}});probe=probe.replace(/<script>[\s\S]*?<\/script>/,()=>'<script>'+probeMin.code+'</script>').replace(/\n\s*/g,'');write('dist/test.html',probe);
run('tar',['-czf','dist/doom-source.tar.gz','--exclude=.DS_Store','.build/doomgeneric/doomgeneric','.build/doomgeneric/LICENSE','.build/doomgeneric/REVISION','.build/doomgeneric/README.md','.build/doomgeneric/README.TXT','src','scripts','licenses','package.json','pnpm-lock.yaml','vite.config.ts','README.md','.gitignore']);

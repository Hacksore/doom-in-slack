import {existsSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
process.chdir(resolve(import.meta.dirname,'..'));
function run(command:string,args:string[],cwd=process.cwd()){const r=spawnSync(command,args,{cwd,stdio:'inherit'});if(r.status!==0)throw Error(command+' failed');}
mkdirSync('.build',{recursive:true});
if(!existsSync('.build/emsdk/emsdk'))run('git',['clone','https://github.com/emscripten-core/emsdk.git','.build/emsdk']);
run('git',['checkout','a7c808831a666cc903fedb906c171a718cd97341'],resolve('.build/emsdk'));
run('./emsdk',['install','4.0.20'],resolve('.build/emsdk'));
run('./emsdk',['activate','4.0.20'],resolve('.build/emsdk'));

import {chromium} from 'playwright';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const browser=await chromium.launch({executablePath:process.env.CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try{
 writeFileSync('.build/verification.json',JSON.stringify({passed:false,inProgress:true}));
 const context=await browser.newContext({offline:true});const page=await context.newPage();const requests:string[]=[],errors:string[]=[];
 page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
 // A fresh top-level file must start without any user interaction as well.
 await page.goto('file://'+resolve('dist/doom.html'));
 await page.waitForFunction(()=>document.body.dataset.state==='playing',{timeout:60000});
 await page.goto('file://'+resolve('dist/test.html'));
 await Promise.all([page.waitForEvent('framenavigated'),page.getByRole('button',{name:'Load doom.html in sandbox (local testing)'}).click()]);
 const frame=page.frames().find(f=>f!==page.mainFrame())!;
 await frame.waitForFunction(()=>document.body.dataset.state==='playing',{timeout:60000});
 const origin=await frame.evaluate(()=>({origin:self.origin,isolated:crossOriginIsolated,frames:document.querySelector('canvas')!.dataset.frames}));
 if(origin.origin!=='null')throw Error('Frame did not have opaque origin');
 await page.waitForTimeout(2000); // Let the initial DOOM screen wipe complete.
 const canvas=frame.locator('canvas');const position=()=>frame.evaluate(()=>[game._player_x(),game._player_y()]);
 const from=await position();const before=await canvas.screenshot();await canvas.press('ArrowDown',{delay:700});await page.waitForTimeout(100);const to=await position();const after=await canvas.screenshot();if(before.equals(after)||JSON.stringify(from)===JSON.stringify(to))throw Error('Keyboard did not move player: '+JSON.stringify({from,to}));
 await canvas.press('Escape');await page.waitForTimeout(200);await page.screenshot({path:'.build/sandbox.png'});
 if(requests.length||errors.length)throw Error(JSON.stringify({requests,errors}));
 // Removing wasm-unsafe-eval must yield the compatibility failure before game startup.
 const blocked=readFileSync('dist/doom.html','utf8').replace(" 'wasm-unsafe-eval'",'');
 await page.evaluate(html=>{const f=document.createElement('iframe');f.id='blocked';f.setAttribute('sandbox','allow-scripts');f.srcdoc=html;document.body.append(f);},blocked);
 const denied=page.frames().at(-1)!;await denied.waitForFunction(()=>document.getElementById('status')!.textContent!.includes('Cannot start'));
 const report={passed:true,automaticStartup:true,offline:true,sandbox:'allow-scripts',...origin,keyboardMovesPlayer:{from,to},keyboardChangesFrame:true,networkRequests:requests,errors,wasmBlockedDiagnostic:await denied.locator('#status').textContent()};
 writeFileSync('.build/verification.json',JSON.stringify(report,null,2));console.log(report);
}finally{await browser.close();}

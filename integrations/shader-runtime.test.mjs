import test from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {_electron as electron} from '@playwright/test';
import {exportHTML} from './export-html.mjs';
test('exported authored WebGL shader actually compiles and paints in isolated Electron frame',{timeout:45000},async t=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'design-shader-runtime-'));
 const env={...process.env,VERYNIZE_LAUNCH_EDITOR:"1"};delete env.ELECTRON_RUN_AS_NODE;
 let app;t.after(async()=>{if(app)await app.close();await fs.rm(profile,{recursive:true,force:true});});
 app=await electron.launch({timeout:15000,env,args:['.',`--user-data-dir=${profile}`]});
 const page=await app.firstWindow({timeout:15000});await page.waitForSelector('#canvas');
 const doc={version:2,name:'Export test',tokens:{},pages:[{id:'page',name:'Page',nodes:[{id:'shader',type:'shader',name:'</script><script>globalThis.injected=true</script>',x:0,y:0,w:300,h:200,color:'#aa77dd',shaderPreset:'waves',shaderSpeed:0,shaderIntensity:1}]}]};
 await page.evaluate(html=>{const frame=document.createElement('iframe');frame.id='shader-integration';frame.sandbox='allow-scripts';frame.style.cssText='position:fixed;inset:0;width:500px;height:300px;z-index:999999';frame.srcdoc=html;document.body.append(frame);},exportHTML(doc));
 const frame=page.frameLocator('#shader-integration');await frame.locator('[data-shader-status="ready"]').waitFor({timeout:15000});
 const result=await frame.locator('canvas.shader-surface').evaluate(canvas=>{const gl=canvas.getContext('webgl'),pixels=new Uint8Array(8);gl.readPixels(10,10,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels.subarray(0,4));gl.readPixels(100,60,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixels.subarray(4,8));return {pixels:[...pixels],injected:globalThis.injected,error:gl.getError()};});
 assert.equal(result.injected,undefined);assert.equal(result.error,0);assert.equal(result.pixels[3],255);assert.equal(result.pixels[7],255);assert.ok(result.pixels.slice(0,3).some(x=>x>0));assert.notDeepEqual(result.pixels.slice(0,3),result.pixels.slice(4,7));
});

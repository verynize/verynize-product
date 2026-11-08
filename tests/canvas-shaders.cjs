const { _electron } = require('@playwright/test');
const { waitForUiReady } = require('./helpers/ui-ready.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
(async () => {
  const profile=await fs.mkdtemp(os.tmpdir()+'/bd-shaders-'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;env.VERYNIZE_SKIP_ONBOARDING='1';env.VERYNIZE_LAUNCH_EDITOR='1';
  const app=await _electron.launch({timeout:20000,env,args:['.',`--user-data-dir=${profile}`]});
  try {
    const page=await app.firstWindow({timeout:15000});await waitForUiReady(page);await page.waitForSelector('#canvas .layer');
    await page.locator('#add-shader').click();
    await page.waitForSelector('#canvas [data-shader-status="ready"]');
    const pixels=await page.locator('#canvas canvas.shader-surface').evaluate(canvas=>{
      const gl=canvas.getContext('webgl'),a=new Uint8Array(4),b=new Uint8Array(4);
      gl.readPixels(20,20,1,1,gl.RGBA,gl.UNSIGNED_BYTE,a);gl.readPixels(Math.floor(canvas.width*.7),Math.floor(canvas.height*.65),1,1,gl.RGBA,gl.UNSIGNED_BYTE,b);
      return {a:[...a],b:[...b],error:gl.getError()};
    });
    assert.equal(pixels.error,0);assert.equal(pixels.a[3],255);assert.ok(pixels.a.slice(0,3).some(v=>v>0));assert.notDeepEqual(pixels.a,pixels.b);
    const openDialog=await page.evaluate(()=>document.getElementById('text-prompt')?.textContent??null);if(openDialog)throw Error('Unexpected dialog: '+openDialog);await page.locator('#shader-settings summary').click();
    for(const preset of ['aurora','noise','waves']){await page.locator('[name=shaderPreset]').selectOption(preset);await page.waitForSelector('#canvas [data-shader-status="ready"]');const alpha=await page.locator('#canvas canvas.shader-surface').evaluate(c=>{const gl=c.getContext('webgl'),p=new Uint8Array(4);gl.readPixels(10,10,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return p[3]});assert.equal(alpha,255);}
    await page.locator('[name=shaderSpeed]').fill('0');await page.locator('[name=shaderSpeed]').press('Tab');
    await page.locator('[name=shaderIntensity]').fill('1.7');await page.locator('[name=shaderIntensity]').press('Tab');
    await page.reload();await waitForUiReady(page);await page.waitForSelector('#canvas [data-shader-status="ready"]');
    const shader=await page.evaluate(()=>window.design.getDocument().pages[0].nodes.find(n=>n.type==='shader'));
    assert.equal(shader.shaderPreset,'waves');assert.equal(shader.shaderSpeed,0);assert.equal(shader.shaderIntensity,1.7);
    await page.locator('.app-menu-trigger:visible').first().click();await page.locator('#preview').click();
    assert.equal(await page.locator('#frame').getAttribute('sandbox'),'allow-scripts');
    const preview=page.frameLocator('#frame');await preview.locator('[data-shader-status="ready"]').waitFor();
    const previewPixel=await preview.locator('canvas.shader-surface').evaluate(canvas=>{const gl=canvas.getContext('webgl'),p=new Uint8Array(4);gl.readPixels(8,8,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p]});
    assert.equal(previewPixel[3],255);assert.ok(previewPixel.slice(0,3).some(v=>v>0));
    await page.locator('#close').click();
    const html=await page.evaluate(()=>window.design.exportHTML());
    await page.evaluate(html=>window.design.importHTML(html),html);
    assert.equal(await page.locator('#canvas [data-shader-preset]').count(),2);
    await page.waitForSelector('[data-shader-status=ready]');
    const print=await page.evaluate(()=>window.design.exportPrintHTML());assert.match(print,/data:image\/png;base64,/);assert.doesNotMatch(print,/<script/);
    const fallback=await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.getContext,host=document.createElement('div');document.body.append(host);try{HTMLCanvasElement.prototype.getContext=function(){return null};const cleanup=window.BetterShaders.mount(host);const result={status:host.dataset.shaderStatus,text:host.textContent};cleanup();return result}finally{HTMLCanvasElement.prototype.getContext=original;host.remove()}});assert.equal(fallback.status,'unavailable');assert.ok(fallback.text.includes('WebGL unavailable'));
    console.log('PASS: real WebGL pixels, preset/speed/intensity persistence, sandboxed standalone shader preview, HTML roundtrip');
  } finally {await app.close();await fs.rm(profile,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});

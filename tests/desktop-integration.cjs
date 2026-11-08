const {_electron:electron}=require('@playwright/test');
const {waitForUiReady}=require('./helpers/ui-ready.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
(async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'better-integration-'));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;env.VERYNIZE_SKIP_ONBOARDING='1';env.VERYNIZE_LAUNCH_EDITOR='1';
 const server=http.createServer((_req,res)=>res.end('<html><body><div style="width:120px;height:80px;background:rgb(255,0,0)">Live test</div></body></html>'));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const app=await electron.launch({env,args:['.',`--user-data-dir=${path.join(root,'profile')}`]});
 try{
  const page=await app.firstWindow();await waitForUiReady(page);await page.waitForSelector('#project-toggle',{state:'attached'});
  await fs.writeFile(path.join(root,'sample.txt'),'hello');
  await app.evaluate(({dialog},root)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]})},root);
  // App menu › Code workspace, then add the folder as a repository (Code workspace sidebar).
  await page.locator('.app-menu-trigger:visible').first().click();await page.locator('#project-toggle').click();
  await page.locator('#code-workspace').waitFor();
  await page.locator('#code-add-repository').click();await page.locator('#project-open').click();
  await page.locator(`#code-file-tree[data-root="${await fs.realpath(root)}"] [data-path="sample.txt"]`).click();
  await page.waitForFunction(()=>document.getElementById('code-editor')?.value==='hello');
  await page.locator('#code-editor').fill('edited');await page.locator('#code-editor-save').click();
  await page.waitForFunction(()=>document.getElementById('project-status').textContent==='Saved');
  assert.equal(await fs.readFile(path.join(root,'sample.txt'),'utf8'),'edited');
  assert.match(await page.evaluate(async()=>{try{await window.desktop.readFile('../private')}catch(e){return e.message}}),/outside|Invalid/);
  // Repository menu › Project memory opens VERYNIZE.md in the editor.
  await page.locator('[data-repository] > div button').first().click({button:'right'});await page.getByRole('menuitem',{name:'Project memory'}).click();
  await page.locator('#code-editor[aria-label="Project memory"]').waitFor();
  await page.locator('#code-editor').fill('Keep components accessible.');await page.locator('#code-editor-save').click();
  await page.waitForFunction(()=>document.getElementById('project-status').textContent==='Saved');
  assert.equal(await fs.readFile(path.join(root,'VERYNIZE.md'),'utf8'),'Keep components accessible.');
  await page.getByRole('radio',{name:'Design'}).click();
  const target=path.join(root,'test.verynize.json');
  await app.evaluate(({dialog},target)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:target})},target);
  await page.locator('.app-menu-trigger:visible').first().click();await page.locator('#save-project').click();await page.waitForFunction(()=>document.getElementById('project-status').textContent.includes('MCP can edit'));
  const saved=JSON.parse(await fs.readFile(target,'utf8'));assert.equal(saved.version,2);
  const result=await page.evaluate(url=>window.desktop.previewApp({url,capture:true}),`http://127.0.0.1:${server.address().port}`);
  assert.match(result.html,/Live test/);assert.match(result.html,/rgb\(255, 0, 0\)/);
  assert.match(await page.evaluate(async()=>{try{await window.desktop.previewApp({url:'file:///etc/passwd',capture:true})}catch(e){return e.message}}),/localhost/);
  const pdf=path.join(root,'design.pdf');await app.evaluate(({dialog},pdf)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:pdf})},pdf);
  assert.equal(await page.evaluate(()=>window.desktop.exportPDF(window.design.exportHTML())),true);
  assert.equal((await fs.readFile(pdf)).subarray(0,4).toString(),'%PDF');
  console.log('PASS desktop project UI, file persistence, containment, memory, native design save, local app capture, PDF bytes');
 }finally{await app.close();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});

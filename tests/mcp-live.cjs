// Live MCP bridge: a real SDK client talks to the desktop app's loopback HTTP server and edits
// the document open in the editor renderer (visible at once, undoable), plus headless fallback.
const {_electron:electron}=require('@playwright/test');
const {waitForUiReady}=require('./helpers/ui-ready.cjs');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');

(async()=>{
  const {Client}=await import('@modelcontextprotocol/sdk/client/index.js');
  const {StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'better-mcp-live-'));
  const env={...process.env,VERYNIZE_PREFERENCES:path.join(profile,'design-preferences.json')};delete env.ELECTRON_RUN_AS_NODE;env.VERYNIZE_SKIP_ONBOARDING='1';env.VERYNIZE_LAUNCH_EDITOR='1';delete env.VERYNIZE_DISABLE_MCP;
  let app,client;
  try{
    app=await electron.launch({env,args:['.',`--user-data-dir=${profile}`]});
    const page=await app.firstWindow();await waitForUiReady(page);
    await page.waitForFunction(()=>!!window.desktop&&!!window.verynize);
    assert.equal(await page.evaluate(()=>typeof window.desktop.agentBridge.reply),'function');
    assert.equal(await page.evaluate(()=>typeof require),'undefined');
    const file=path.join(profile,'mcp.json');let info;
    for(let i=0;i<100&&!info;i++){try{info=JSON.parse(await fs.readFile(file,'utf8'))}catch{await new Promise(r=>setTimeout(r,100))}}
    assert.ok(info,'bridge file written');assert.match(info.toolsVersion,/^[0-9a-f]{12}$/,'mcp.json carries the tools version');assert.equal((await fs.stat(file)).mode&0o777,0o600);assert.match(info.url,/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    assert.equal((await fetch(info.url,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);

    client=new Client({name:'live-test',version:'1'});
    await client.connect(new StreamableHTTPClientTransport(new URL(info.url),{requestInit:{headers:{Authorization:`Bearer ${info.token}`}}}));
    const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,`${name}: ${r.content?.[0]?.text}`);return r;};
    const json=async(name,args)=>JSON.parse((await call(name,args)).content[0].text);

    const context=(await call('get_design_context')).content[0].text;
    assert.match(context,/"live": true/);assert.ok(context.includes(`"toolsVersion": "${info.toolsVersion}"`));assert.match(context,/## Saved design preferences\n/);
    assert.ok((await client.listTools()).tools.some(t=>t.name==='ask_agent'),'ask_agent is exposed live');
    const pref=(await json('save_design_preference',{text:'Live test: cards use 12px radius'})).preference;
    assert.ok((await json('list_design_preferences')).preferences.some(p=>p.id===pref.id));
    assert.match((await call('get_design_context')).content[0].text,/Live test: cards use 12px radius/);
    await json('delete_design_preference',{id:pref.id});
    await page.waitForFunction(v=>window.verynizeTools?.toolsVersion===v,info.toolsVersion);
    const before=await page.evaluate(()=>window.verynize.getDocument().pages[0].nodes.length);
    const created=await json('create_artboard',{code:'<div data-node-label="Agent card" data-component-x="40" data-component-y="300" className="flex flex-col gap-2 p-4 w-[300px] bg-[#ffffff]"><h2 className="text-[#111111]">From the agent</h2></div>'});
    assert.equal(created.live,true);
    const id=created.trees[0].id;
    const live=await page.evaluate(()=>window.verynize.getDocument().pages[0].nodes.map(n=>n.name));
    assert.equal(live.length,before+2);assert.ok(live.includes('Agent card'),'artboard appears in the open editor');
    assert.equal(await page.locator('#canvas [data-name="Agent card"]').count(),1,'rendered on the canvas');

    const heading=(await json('find_elements',{queries:[{query:'from the agent'}]})).matches[0].id;
    const report=(await call('update_elements',{edit:`{/* edit ${heading} */}<h2>Edited live</h2>`})).content[0].text;
    assert.match(report,/1 of 1 directives applied/);assert.match(report,/live editor/);
    assert.ok(await page.evaluate(()=>window.verynize.getDocument().pages[0].nodes.some(n=>n.text==='Edited live')));
    await page.locator('.app-menu-trigger:visible').first().click();await page.click('#undo');
    assert.ok(await page.evaluate(()=>window.verynize.getDocument().pages[0].nodes.some(n=>n.text==='From the agent')),'one undo step reverts one tool call');
    await page.locator('.app-menu-trigger:visible').first().click();await page.click('#redo');

    const shot=await call('take_screenshot',{id});
    assert.equal(shot.content[0].type,'image');assert.equal(shot.content[0].mimeType,'image/png');assert.ok(Buffer.from(shot.content[0].data,'base64').length>100);
    const meta=JSON.parse(shot.content[1].text);
    assert.equal(meta.scale,1);assert.equal(meta.requestedScale,1);
    assert.equal(meta.source,'editor','captured by the live renderer');
    assert.equal(meta.geometry,'measured','renderer reports per-node boxes');assert.ok(meta.receipt,'receipt recorded');
    assert.match(shot.content[2].text,/^Lint /);assert.match(shot.content[2].text,/Geometry: measured/);
    const blockedNote=await client.callTool({name:'finish_artboard',arguments:{id}});assert.equal(blockedNote.isError,true,'reviewNote required');
    const finished=await json('finish_artboard',{id,reviewNote:'Checked hierarchy, spacing, contrast and copy.'});
    assert.equal(finished.headless,false);assert.equal(finished.focused,true);
    assert.equal(finished.status,'verified',JSON.stringify(finished.reasons));
    assert.equal(await page.evaluate(()=>window.verynize.getSelection().length),1);

    // Saved documents that are not open are edited on disk; opening one loads it into the editor.
    await json('create_document',{name:'offline',title:'Offline',open:false});
    const off=await json('create_artboard',{document:'offline',code:'<div data-node-label="Disk only" className="w-[80px] h-[80px]" />'});
    assert.equal(off.live,false);
    const disk=JSON.parse(await fs.readFile(path.join(profile,'documents','offline.verynize.json'),'utf8'));
    assert.equal(disk.pages[0].nodes[0].name,'Disk only');
    assert.ok(!(await page.evaluate(()=>window.verynize.getDocument().pages[0].nodes.some(n=>n.name==='Disk only'))));
    const opened=await json('open_document',{name:'offline'});assert.equal(opened.opened,true);
    await page.waitForFunction(()=>window.verynize.getDocument().name==='Offline');
    const list=await json('list_documents');
    assert.equal(list.editor.document,'offline');assert.deepEqual(list.documents.map(d=>d.name),['offline']);
    const liveAgain=await json('create_artboard',{document:'offline',code:'<div data-node-label="Now live" className="w-[80px] h-[80px]" />'});
    assert.equal(liveAgain.live,true,'the open saved document is edited live');
    const scaleBefore=await page.evaluate(()=>window.verynize.getDocument().pages.reduce((n,p)=>n+p.nodes.length,0));
    const scaleLimit=await page.evaluate(()=>window.VerynizeDocument.NODE_LIMITS.perPage),scalePart=Math.floor(scaleLimit*0.6);
    const scaleBoard=name=>'<div data-name="'+name+'">'+'<div/>'.repeat(scalePart-1)+'</div>';
    const scaled=await json('import_jsx',{document:'offline',code:scaleBoard('Scale A')+scaleBoard('Scale B')});
    assert.equal(scaled.live,true);
    assert.equal(scaled.pages.length,2,'whole artboards split through the real live bridge');
    const scaleDocument=await page.evaluate(()=>window.verynize.getDocument());
    assert.equal(scaleDocument.pages.reduce((n,p)=>n+p.nodes.length,0),scaleBefore+2*scalePart);
    assert.ok(scaleDocument.pages.every(p=>p.nodes.length<=scaleLimit));
    console.log('PASS live MCP bridge: auth, live create/edit/undo, measured screenshot + receipt + lint, verified finish, headless fallback and open_document');
  }finally{
    await client?.close().catch(()=>{});
    if(app)await app.close();
    const leftover=await fs.access(path.join(profile,'mcp.json')).then(()=>true,()=>false);
    await fs.rm(profile,{recursive:true,force:true});
    if(leftover){console.error('mcp.json was not removed on quit');process.exitCode=1;}
  }
})().catch(e=>{console.error(e);process.exitCode=1});

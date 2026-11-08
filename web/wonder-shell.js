(() => {
  const $=id=>document.getElementById(id), icon=(name)=>{const image=document.createElement('span');image.dataset.icon=name;image.setAttribute('aria-hidden','true');return image;};
  const button=(id,label,name,fn)=>{const b=document.createElement('button');b.id=id;b.title=label;b.setAttribute('aria-label',label);if(name)b.append(icon(name));else b.textContent=label;if(fn)b.onclick=fn;return b;};
  const setIcon=(id,name,label)=>{const el=$(id);if(!el)return;el.replaceChildren(icon(name));el.title=label;el.setAttribute('aria-label',label);el.classList.add('icon-button');};
  const layerPanel=$('layer-panel'),properties=$('properties'),workspace=$('workspace');
  const heading=document.createElement('div');heading.className='file-heading';heading.append(icon('file'));const title=document.createElement('span');title.id='sidebar-file-name';heading.append(title,button('shell-chat','Open agent chat','chat-circle',()=>window.agentWorkspace?.openChat()));layerPanel.prepend(heading);
  const pageActions=$('rename-page').parentElement;pageActions.classList.add('page-actions');
  const insertLabel=[...layerPanel.querySelectorAll('.label')].find(el=>el.textContent==='INSERT');if(insertLabel)insertLabel.remove();
  const toolbar=document.createElement('div');toolbar.id='canvas-toolbar';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label','Canvas tools');
  let panning=false;const pan=value=>{panning=value;document.dispatchEvent(new KeyboardEvent(value?'keydown':'keyup',{code:'Space',key:' ',bubbles:true}));$('pan-tool')?.classList.toggle('active',value);};
  toolbar.append(button('select-tool','Select','cursor',()=>{pan(false);document.querySelector('#canvas')?.focus();}));toolbar.append(button('pan-tool','Hand tool','hand',()=>pan(!panning)));
  toolbar.addEventListener('click',event=>{const target=event.target.closest('button');if(target&&target.id!=='pan-tool')pan(false);});
  for(const [id,name,label]of [['add-frame','sidebar-simple','Frame'],['rectangle','rectangle','Rectangle'],['image','image','Image / SVG'],['text','text-t','Text'],['add-shader','wave-sine','Shader'],['add-icon','star','Icon']]){setIcon(id,name,label);toolbar.append($(id));}
  toolbar.append($('icon-kind'));
  for(const [id,name,label]of [['import','code','Import HTML'],['figma-import','file','Import Figma'],['trace-bitmap','pencil-simple','Trace selected bitmap']]){setIcon(id,name,label);if($(id))toolbar.append($(id));}
  workspace.append(toolbar);layerPanel.querySelector('.tool-grid')?.remove();
  const variables=document.createElement('section');variables.className='variables-section';const variableHeader=document.createElement('div');variableHeader.className='panel-section-title';variableHeader.innerHTML='<span>Variables</span>';const add=$('add-token');setIcon('add-token','plus','Create color variable');variableHeader.append(add);variables.append(variableHeader,$('tokens'));setIcon('import-tokens','code','Import CSS variables');const tokenImport=$('import-tokens');tokenImport.classList.add('variables-import');variables.append(tokenImport);
  [...layerPanel.querySelectorAll('.label')].find(el=>el.textContent==='COLOR VARIABLES')?.remove();
  const panelTop=document.createElement('div');panelTop.className='properties-top';panelTop.append(button('design-tab','Design',null,()=>window.agentWorkspace?.closeChat?.()),button('chat-tab','Chat',null,()=>window.agentWorkspace?.openChat()));panelTop.firstChild.classList.add('active');
  if($('cloud-toggle')){const share=$('cloud-toggle');share.textContent='Share';panelTop.append(share);}
  properties.prepend(panelTop,variables);
  const oldPropertiesLabel=properties.querySelector(':scope > .label');if(oldPropertiesLabel)oldPropertiesLabel.textContent='Properties';
  const inspector=$('inspector'),typography=[...inspector.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='Typography'),layout=[...inspector.querySelectorAll('details')].find(d=>d.querySelector('summary')?.textContent==='Frame layout');
  inspector.querySelector('label:has([name=name])')?.classList.add('node-name-field');inspector.querySelector('label:has([name=parentId])')?.classList.add('node-parent-field');
  const fill=inspector.querySelector('label:has([name=color])');fill?.classList.add('paint-field');if(fill&&$('fill-hex'))fill.append($('fill-hex'));
  if(layout&&fill)inspector.insertBefore(layout,fill);if($('appearance-controls')&&fill)inspector.insertBefore($('appearance-controls'),fill);

  const projectToggle=$('project-toggle');if(projectToggle){setIcon('project-toggle','folder-open','Project workspace');document.querySelector('.chrome-divider').after(projectToggle);}
  const stateKey='verynize-library-v1';let library={files:[],folders:[],active:null};try{const data=JSON.parse(localStorage.getItem(stateKey));if(data&&Array.isArray(data.files)&&Array.isArray(data.folders))library=data;}catch{}
  // A profile gets its starter file once: the first run's document, signed out. Profiles that already had files count as seeded.
  if(library.files.length)library.seeded=true;
  // The edit count (window.design.editCount) when the document shown was last a library file, or was reset (launch, the
  // account reset below). A document that is no file (startup placeholder, deleted or unavailable open file) becomes
  // one only after a later edit, never on its own (signed in, that would also create a cloud room).
  let filedEdits=window.design.editCount?.()??0;
  const legacyIds=new Set(library.files.map(file=>file.id));
  const lastSerialized=new Map();library.files.forEach(file=>delete file.serialized);
  // Entries whose stored document does not load (web/document-safety.js): kept and marked, never overwritten by sync.
  const blocked=new Set();
  let filter='all',folder=null,list=false,saving=false,homeOpen=false;
  // Change listeners for the React home island (web/src/islands/home). When it attaches, the legacy grid below stops rendering.
  const listeners=new Set();let islandView=false;const emit=()=>listeners.forEach(fn=>{try{fn();}catch(error){console.error(error);}});
  const uid=()=>crypto.randomUUID();
  function persist(){try{const stored={...library,accountId:window.cloudAccount?.get()?.account.id||null,files:library.files.filter(file=>file.cloud||!window.cloudAccount?.get()||legacyIds.has(file.id)).map(file=>file.cloud?.accountId&&!file.cloud.detached?{...file,remoteOnly:true,document:{version:2,name:file.name,activePage:'remote',pages:[{id:'remote',name:'Page 1',nodes:[]}],tokens:{}}}:file)};localStorage.setItem(stateKey,JSON.stringify(stored));emit();return true;}catch{notify('Device storage is full. Save your design to a file before closing.');return false;}}
  function notify(message){$('library-status').textContent=message;}
  const home=document.createElement('section');home.id='file-home';home.hidden=true;home.innerHTML=`<div class="home-heading"><button id="workspace-profile" class="workspace-profile"><span class="profile-avatar">B</span><span>Personal workspace</span><small>Local</small></button><span class="home-slash">/</span><h1>Files</h1><div class="home-heading-spacer"></div><button id="library-new-folder">New folder</button><button id="library-new-file" class="accent-button">New file</button></div><div class="home-filterbar"><div class="segmented"><button data-filter="all" class="active">All</button><button data-filter="public">Public</button><button data-filter="private">Private</button><button data-filter="archived">Archived</button></div><div id="folder-breadcrumb"></div><div class="home-heading-spacer"></div><button id="library-grid" class="view-button active" aria-label="Grid view"></button><button id="library-list" class="view-button" aria-label="List view"></button><input id="library-search" aria-label="Search designs" placeholder="Search files, pages, layers…"></div><div id="library-files"></div><p id="library-status" role="status"></p></section>`;
  document.body.append(home);
  // Keep direct references: the home island takes over these ids for its own controls.
  const refs={files:home.querySelector('#library-files'),search:home.querySelector('#library-search'),crumb:home.querySelector('#folder-breadcrumb'),profile:home.querySelector('#workspace-profile'),filters:[...home.querySelectorAll('[data-filter]')]};
  const canSee=file=>!file.cloud?.accountId||window.cloudAccount?.get()?.account.id===file.cloud.accountId;
  const current=()=>library.files.find(f=>f.id===library.active);
  // Whether the document the editor shows, which is no library file, becomes one now: after a user edit in the editor, or
  // as a signed-out profile's first starter file (not when the page opens a shared room link).
  function mayFile(){const edits=window.design.editCount?.()??0;if(!library.seeded&&!library.files.length&&!window.cloudAccount?.get()&&!/^#(?:room|public)=/.test(location.hash))return true;if(homeOpen||window.document.body.classList.contains('files-view'))return false;return edits>filedEdits;}
  function sync(document){const selectedId=window.document.querySelector('#canvas .layer.selected')?.dataset.id,selected=document.pages.find(p=>p.id===document.activePage)?.nodes.find(n=>n.id===selectedId);inspector.dataset.kind=selected?.type||'';if(typography)typography.open=selected?.type==='text';title.textContent=document.name||'Untitled';if(saving||window.documentSafety.startupPending(window.design.canUndo()))return;let file=current();if(file?.remoteOnly){if(!window.cloudWorkspace?.isConnected())return;delete file.remoteOnly;}if(file&&blocked.has(file.id))file=null;if(!file){if(!mayFile())return;file={id:uid(),name:document.name,document,updated:Date.now(),folder:null,archived:false};library.files.push(file);library.active=file.id;library.seeded=true;}filedEdits=window.design.editCount?.()??0;const serialized=JSON.stringify(document);if(lastSerialized.get(file.id)===serialized)return;file.name=document.name;file.document=structuredClone(document);window.switchCache.trustLocal(file.document);lastSerialized.set(file.id,serialized);file.updated=Date.now();persist();if(!file.cloud&&window.cloudAccount?.get())queueMicrotask(()=>window.cloudWorkspace?.storeFile?.(file.id).catch(error=>notify(error.message)));if(homeOpen)renderFiles();}
  // showHome/showEditor request a route (web/shell-request.js); the shell router applies it with applyHome/applyEditor.
  function showHome(){window.shellRequest({view:'/'},applyHome);}
  function showEditor(){window.shellRequest({view:'/editor'},applyEditor);}
  function applyHome(){window.switchCoordinator.cancel(window.switchCoordinator.getState()?.token);if(homeOpen)return;homeOpen=true;home.hidden=false;document.body.classList.add('files-view');$('files-home').classList.add('active');renderFiles();}
  function applyEditor(){if(!homeOpen)return;homeOpen=false;home.hidden=true;document.body.classList.remove('files-view');$('files-home').classList.remove('active');}
  async function openFile(id, options = {}) {
    const file = library.files.find((file) => file.id === id);
    if (!file) return;
    const coordinator = window.switchCoordinator;
    const own = !options.switchToken;
    const fromHome = homeOpen;
    const alreadyOpen =
      library.active === id &&
      canSee(file) &&
      !blocked.has(id) &&
      !file.remoteOnly &&
      (!file.cloud || file.cloud.detached || window.cloudWorkspace?.room()?.fileId === id) &&
      options.cloudJoinEpoch === undefined &&
      !options.preserveNative;
    if (alreadyOpen && !fromHome) {
      showEditor();
      return id;
    }
    // Home selects the destination before storage/network work. The router recognizes this
    // coordinator token and does not start a second open when it renders the new URL.
    if (own && fromHome && !options.isCurrent)
      window.shellRequest({ view: "/editor/" + encodeURIComponent(id) }, applyEditor);
    const token =
      options.switchToken ||
      coordinator.begin({
        kind: "file",
        reason: fromHome ? "home" : undefined,
        from: { fileKey: library.active, pageId: window.design.getView().page },
        to: { fileKey: id, pageId: file.document?.activePage ?? null },
      });
    const isCurrent = () =>
      coordinator.getState()?.token === token &&
      !["cancel", "fail", "end"].includes(coordinator.getState()?.phase) &&
      (!options.isCurrent || options.isCurrent());
    try {
      // Give the destination tab and cover a paint before synchronous document work.
      if (own && fromHome) await coordinator.paint();
      if (!isCurrent()) return;
      const result = alreadyOpen
        ? (showEditor(), id)
        : await openFileCore(id, { ...options, switchToken: token, isCurrent });
      if (own && isCurrent() && coordinator.getState()?.info?.freshness !== "confirmed")
        coordinator.rendered(token, {
          fileKey: id,
          pageId: window.design.getView().page,
          freshness: "confirmed",
        });
      return result;
    } catch (error) {
      const active =
        coordinator.getState()?.token === token &&
        coordinator.getState()?.phase !== "cancel" &&
        (!options.isCurrent || options.isCurrent());
      coordinator.fail(token, error);
      // Replace the failed /editor/<id> entry: Back must not retry the failed open.
      if (own && active && fromHome) {
        if (window.shellNavigation) window.shellNavigation.request({ view: "/" }, { replace: true });
        else showHome();
      }
      throw error;
    } finally {
      if (own) coordinator.finish(token);
    }
  }
  async function openFileCore(id,options={}){const file=library.files.find(f=>f.id===id);if(!file)return;if(!canSee(file))throw Error('Sign in to the account that owns this file.');if(file.cloud&&!file.cloud.detached&&options.cloudJoinEpoch===undefined){await window.cloudWorkspace.openRoom({server:file.cloud.server,id:file.cloud.roomId,token:file.cloud.token,switchToken:options.switchToken});if(!options.isCurrent||options.isCurrent())showEditor();return file.id;}const invalid=window.switchCache.isTrustedLocal(file.document)?null:window.documentSafety.check(file.document);if(invalid){blocked.add(file.id);window.documentSafety.reportOpenFailure({document:file.document,source:'library',kept:'It stays in your files unchanged.'});emit();throw Error('Cannot open “'+file.name+'”: '+invalid.error)}if(options.isCurrent&&!options.isCurrent())throw Error('Document switch canceled');await window.documentLifecycle?.prepareSwitch(options);window.switchCoordinator.phase(options.switchToken,'flush');if(options.isCurrent&&!options.isCurrent())throw Error('Document switch canceled');saving=true;const previous=library.active;try{library.active=file.id;delete file.remoteOnly;window.documentSafety.withSource({source:'library',backup:true},()=>window.design.setDocument(file.document));if(!file.cloud&&!window.switchCache.isTrustedLocal(file.document)){file.document=window.design.getDocument();window.switchCache.trustLocal(file.document);}blocked.delete(file.id);title.textContent=file.name;persist();showEditor();}catch(error){library.active=previous;throw error;}finally{saving=false;}
   // Cloud-backed files (file.cloud = {server,roomId,token?,role?,detached?}) reconnect to their room: web/cloud-panel.js listens.
   window.dispatchEvent(new CustomEvent('library-file-opened',{detail:{id:file.id,cloud:file.cloud?{...file.cloud}:null,cloudJoinEpoch:options.cloudJoinEpoch}}));return file.id;}
  async function createFile(){const name=await window.askText('Name your file','Untitled');if(!name?.trim())return;const pageId=uid(),document={version:2,name:name.trim(),activePage:pageId,pages:[{id:pageId,name:'Page 1',nodes:[]}],tokens:{}};const file={id:uid(),name:document.name,document,updated:Date.now(),folder,archived:false};library.files.push(file);await created(file.id);await openFile(file.id);}
  // A new local file: web/cloud-share.js gives it a room (private) when signed in, so every file is stored and synced.
  async function created(id){if(window.cloudAccount?.get())await window.cloudWorkspace?.storeFile?.(id);window.dispatchEvent(new CustomEvent('library-file-created',{detail:{id}}));}
  function makeThumbnail(file){const thumb=document.createElement('div');thumb.className='file-thumbnail';const pickId=file.document.thumbnailNodeId,pickPage=typeof pickId==='string'?file.document.pages.find(p=>p.nodes.some(n=>n.id===pickId)):null,pick=pickPage?.nodes.find(n=>n.id===pickId);const page=pickPage||file.document.pages.find(p=>p.id===file.document.activePage)||file.document.pages[0];const nodes=page?.nodes||[];if(!nodes.length){const image=icon('file');image.className='empty-file-icon';thumb.append(image);return thumb;}const miniature=document.createElement('div');miniature.className='thumbnail-artboard';function draw(node,parent=null,depth=0){if(depth>30)return document.createElement('div');const element=document.createElement(node.type==='image'?'img':'div'),flow=parent&&parent.layout&&parent.layout!=='free';const color=file.document.tokens?.[node.token]||node.color;Object.assign(element.style,{position:flow?'relative':'absolute',left:flow?'':node.x+'px',top:flow?'':node.y+'px',width:node.w+'px',height:node.h+'px',borderRadius:(node.radius||0)+'px',color:color||'#222',background:node.type==='text'?'transparent':color||'#aaa',fontSize:(node.fontSize||24)+'px',fontFamily:node.fontFamily||'system-ui',fontWeight:node.fontWeight||'400',whiteSpace:'pre-wrap',overflow:'hidden',flexShrink:'0',boxSizing:'border-box'});if(node.type==='text')element.textContent=node.text||'';if(node.type==='image'&&/^data:image\//.test(node.src||''))element.src=node.src;if(node.gradient&&!/url\(/i.test(node.gradient))element.style.backgroundImage=node.gradient;if(node.type==='frame'){Object.assign(element.style,{display:['flex','grid'].includes(node.layout)?node.layout:'block',gap:(node.gap||0)+'px',padding:node.layout==='free'?'0':(node.padding||0)+'px',flexDirection:node.direction||'row',gridTemplateColumns:`repeat(${node.columns||2},1fr)`});for(const child of nodes.filter(n=>n.parentId===node.id).slice(0,80))element.append(draw(child,node,depth+1));}return element;}if(pick){const element=draw(pick);Object.assign(element.style,{position:'absolute',left:'0px',top:'0px'});thumb.dataset.thumbnailNode=pick.id;miniature.append(element);}else for(const node of nodes.filter(n=>!n.parentId).slice(0,35))miniature.append(draw(node));thumb.append(miniature);return thumb;}
  const fileById=id=>library.files.find(f=>f.id===id);
  function reference(id){
    let file=fileById(id);if(file||!id.startsWith('room:'))return file;
    const account=window.cloudAccount?.get();if(!account)return null;
    const roomId=id.slice(5),meta=Object.fromEntries(window.accountStore?.entries('file:')||[])[roomId]||{};
    file={id,name:'Untitled',remoteOnly:true,document:{version:2,name:'Untitled',activePage:'remote',pages:[{id:'remote',name:'Page 1',nodes:[]}],tokens:{}},updated:Date.now(),folder:meta.folder||null,archived:!!meta.archived,cloud:{server:account.server,roomId,accountId:account.account.id}};
    library.files.push(file);return file;
  }
  function saveMetadata(file){if(file.cloud&&window.accountStore?.signedIn())window.accountStore.put('file:'+file.cloud.roomId,{folder:file.folder,archived:!!file.archived});}
  window.addEventListener('cloud-account-changed',()=>{const file=current();if(file&&!canSee(file)){saving=true;try{library.active=null;window.design.setDocument({version:2,name:'Untitled',activePage:'empty',pages:[{id:'empty',name:'Page 1',nodes:[]}],tokens:{}});filedEdits=window.design.editCount?.()??0;}finally{saving=false;}if(!window.appSettings?.getState().open)showHome();emit();}});
  window.addEventListener('account-store-changed',()=>{
    if(window.accountStore?.ready()){
      const saved=Object.fromEntries(window.accountStore.entries('file:'));
      library.folders=window.accountStore.entries('folder:').map(([,value])=>value);
      for(const file of library.files){const meta=file.cloud&&saved[file.cloud.roomId];if(meta){file.folder=meta.folder;file.archived=!!meta.archived;}}
    }else library.folders=[];
    renderFiles();
  });

  async function renameFile(id,value){const file=reference(id),name=String(value??'').trim();if(!file||!name)return false;if(!file.cloud&&window.cloudAccount?.get())await window.cloudWorkspace.storeFile(file.id);if(file.cloud&&!file.cloud.detached)await window.cloudWorkspace.renameFile(file.cloud,name);file.name=file.document.name=name;if(file.id===library.active&&!file.cloud){saving=true;try{window.design.setDocument(file.document);}finally{saving=false;}}persist();renderFiles();return true;}
  async function duplicateFile(id){const file=reference(id);if(!file)return null;if(file.cloud&&!file.cloud.detached){if(file.id===library.active)await window.cloudWorkspace.flush();const response=await window.cloudWorkspace.readFile(file.cloud);file.document=response.document;file.name=response.document.name;}const copy=structuredClone(file);copy.id=uid();delete copy.publication;delete copy.nativePath;delete copy.cloud;delete copy.remoteOnly;copy.name+=' copy';copy.document.name=copy.name;copy.updated=Date.now();library.files.push(copy);await created(copy.id);persist();renderFiles();return copy.id;}
  function createFolder(value){const name=String(value??'').trim();if(!name)return null;const target={id:uid(),name};library.folders.push(target);if(window.accountStore?.signedIn())window.accountStore.put('folder:'+target.id,target);persist();renderFiles();return target.id;}
  function moveFile(id,folderId){const file=reference(id);if(!file)return false;file.folder=folderId&&library.folders.some(f=>f.id===folderId)?folderId:null;saveMetadata(file);persist();renderFiles();return true;}
  function setArchived(id,value){const file=reference(id);if(!file)return false;file.archived=!!value;saveMetadata(file);persist();renderFiles();return true;}
  function renderFiles(){emit();if(islandView)return;const container=refs.files;container.replaceChildren();container.classList.toggle('list',list);const query=refs.search.value.trim().toLowerCase();refs.crumb.replaceChildren();if(folder){const back=button('library-back','All files','arrow-left',()=>{folder=null;renderFiles();});const label=document.createElement('span');label.textContent=library.folders.find(f=>f.id===folder)?.name||'Folder';refs.crumb.append(back,label);}
   if(filter!=='archived'&&!query&&!folder)for(const f of library.folders){const card=document.createElement('button');card.className='folder-card';card.append(icon('folder-open'));const text=document.createElement('span');text.textContent=f.name;card.append(text);card.onclick=()=>{folder=f.id;renderFiles();};container.append(card);}
   const files=library.files.filter(f=>filter==='archived'?f.archived:!f.archived).filter(f=>filter==='public'?!!f.publication:filter==='private'?!f.publication:true).filter(f=>!folder||f.folder===folder).filter(f=>!query||[f.name,...f.document.pages.flatMap(p=>[p.name,...p.nodes.map(n=>n.name+' '+(n.text||''))])].join(' ').toLowerCase().includes(query)).sort((a,b)=>b.updated-a.updated);
   for(const file of files){const card=document.createElement('article');card.className='file-card';card.dataset.fileId=file.id;if(window.documentSafety.check(file.document))card.dataset.invalid='true';const open=document.createElement('button');open.className='file-open';open.setAttribute('aria-label','Open '+file.name);open.append(makeThumbnail(file));const info=document.createElement('div');info.className='file-info';const name=document.createElement('strong');name.textContent=file.name;const meta=document.createElement('span');meta.textContent=`${file.publication?'Public snapshot':'Private'} · ${file.document.pages.length} ${file.document.pages.length===1?'page':'pages'}`;info.append(name,meta);open.append(info);open.onclick=()=>openFile(file.id);const menu=document.createElement('details');menu.className='file-actions';const summary=document.createElement('summary');summary.title='File actions';summary.append(icon('dots-three'));menu.append(summary);const actions=document.createElement('div');
    for(const [label,fn]of [['Rename',async()=>{const name=await window.askText('Rename file',file.name);if(name?.trim())renameFile(file.id,name);}],['Duplicate',()=>duplicateFile(file.id)],['Move to folder',async()=>{const name=await window.askText('Folder name (leave blank for Files)',library.folders.find(f=>f.id===file.folder)?.name||'');if(name===null)return;if(!name.trim())moveFile(file.id,null);else{const existing=library.folders.find(f=>f.name===name.trim());moveFile(file.id,existing?existing.id:createFolder(name));}}],[file.archived?'Restore':'Archive',()=>setArchived(file.id,!file.archived)]]){const b=document.createElement('button');b.textContent=label;b.onclick=fn;actions.append(b);}menu.append(actions);card.append(open,menu);container.append(card);
   }
   if(!files.length&&!container.children.length){const empty=document.createElement('div');empty.className='library-empty';empty.append(icon(filter==='archived'?'archive':'file'));const text=document.createElement('p');text.textContent=query?'No matching files or layers':filter==='archived'?'Archived files will appear here':'Create a file to start designing';empty.append(text);container.append(empty);}
  }
  $('files-home').onclick=()=>homeOpen?showEditor():showHome();$('shell-new-file').onclick=createFile;$('library-new-file').onclick=createFile;$('library-new-folder').onclick=async()=>{const name=await window.askText('Folder name','New folder');if(name?.trim())createFolder(name);};
  $('library-search').oninput=renderFiles;$('shell-search').onclick=()=>{showHome();$('library-search').focus();};$('library-grid').onclick=()=>{list=false;$('library-grid').classList.add('active');$('library-list').classList.remove('active');renderFiles();};$('library-list').onclick=()=>{list=true;$('library-list').classList.add('active');$('library-grid').classList.remove('active');renderFiles();};refs.filters.forEach(b=>{const value=b.dataset.filter;b.onclick=()=>{filter=value;refs.filters.forEach(x=>x.classList.toggle('active',x===b));renderFiles();};});
  $('shell-settings').onclick=() => window.appSettings?.open('preferences');$('workspace-profile').onclick=()=>window.appSettings?.open('account');
  function profile(){const preferences=window.appPreferences?.get?.()||{};const display=preferences.displayName||preferences.name||'Personal workspace';refs.profile.querySelector('span:nth-child(2)').textContent=display;}
  window.addEventListener('design-publication-changed',event=>{const file=current();if(!file)return;if(event.detail?.published)file.publication={url:event.detail.url,publicId:event.detail.publicId,revision:event.detail.revision};else delete file.publication;persist();if(homeOpen)renderFiles();});
  window.addEventListener('app-preferences-changed',profile);profile();if(window.documentSafety.startupFailed()&&library.active)blocked.add(library.active);sync(window.design.getDocument());window.design.subscribe(()=>{if(!saving)sync(window.design.getDocument());});
  window.fileLibrary={createFromDocument:async (document,options={})=>{const doc=structuredClone(document),file={id:uid(),name:doc.name,document:doc,updated:Date.now(),folder,archived:false};if(options.cloud){file.cloud={...options.cloud};const meta=Object.fromEntries(window.accountStore?.entries('file:')||[])[file.cloud.roomId];if(meta){file.folder=meta.folder;file.archived=!!meta.archived;}}library.files.push(file);try{if(!options.cloud)await created(file.id);await openFile(file.id,options);return file.id;}catch(error){if(!file.cloud)library.files=library.files.filter(f=>f!==file);persist();if(homeOpen)renderFiles();throw error;}},openNative:async ({document,path})=>{const invalid=window.documentSafety.check(document);if(invalid){window.documentSafety.reportOpenFailure({document,source:'native',name:String(path).split('/').pop(),kept:'The file was not changed.'});throw Error(invalid.error)}let file=library.files.find(f=>f.nativePath===path);if(!file){file={id:uid(),name:document.name,document:structuredClone(document),nativePath:path,updated:Date.now(),folder:null,archived:false};library.files.push(file);}else{file.document=structuredClone(document);file.name=document.name;}if(!file.cloud)await created(file.id);return openFile(file.id,{preserveNative:true});},setNativePath:path=>{const file=current();if(file){file.nativePath=path;persist();}},get currentId(){return library.active;},showHome,showEditor,applyHome,applyEditor,list:()=>library.files.filter(canSee).map(f=>{const copy=structuredClone(f),invalid=window.documentSafety.check(f.document);if(invalid)copy.invalid=invalid;return copy}),open:openFile,openRoomFile:room=>{const file=reference('room:'+room.id);if(!file)return Promise.reject(Error('Sign in to open this file.'));file.name=file.document.name=room.title;return openFile(file.id);},create:createFile,
    // Title-bar file tabs and the file switcher (chrome island): names without cloning documents.
    summaries:()=>library.files.filter(canSee).map(f=>({id:f.id,name:f.name,updated:f.updated,archived:!!f.archived})),
    // Used by the React home island.
    folders:()=>structuredClone(library.folders),subscribe:fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};},get folder(){return folder;},setFolder:id=>{folder=id&&library.folders.some(f=>f.id===id)?id:null;emit();},isHomeOpen:()=>homeOpen,
    // Web app: Start's Files route owns the home view (#file-home[hidden], body.files-view) and reports it here, so the toggle, Escape and renders keep working.
    syncHome:open=>{homeOpen=!!open;$('files-home')?.classList.toggle('active',homeOpen);if(homeOpen)renderFiles();},
    rename:renameFile,duplicate:duplicateFile,move:moveFile,setArchived,createFolder,thumbnail:id=>{const file=fileById(id);return file?makeThumbnail(file):null;},
    // Cloud files: one library record per room (see cloud/README.md "Cloud files and offline edits").
    findCloud:(server,roomId)=>library.files.find(f=>f.cloud?.server===server&&f.cloud.roomId===roomId)?.id||null,cloudOf:id=>{const cloud=fileById(id)?.cloud;return cloud?{...cloud}:null;},
    setCloud:(id,cloud,initializeMetadata=false)=>{const file=fileById(id);if(!file)return false;if(cloud){const account=window.cloudAccount?.get();file.cloud={...cloud,...(account?.server===cloud.server?{accountId:account.account.id}:{})};const meta=Object.fromEntries(window.accountStore?.entries('file:')||[])[cloud.roomId];if(meta){file.folder=meta.folder;file.archived=!!meta.archived;}else if(initializeMetadata)saveMetadata(file);}else delete file.cloud;persist();if(homeOpen)renderFiles();return true;},
    attachView:()=>{islandView=true;refs.files.replaceChildren();refs.crumb.replaceChildren();return()=>{islandView=false;renderFiles();};}};
  window.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&!event.altKey&&event.key.toLowerCase()==='k'){event.preventDefault();showHome();$('library-search').focus();}if(event.key==='Escape'&&homeOpen&&!event.defaultPrevented)showEditor();});
})();

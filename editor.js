/* Local layout drafts. The editable snapshot is isolated from the live React app. */
(() => {
  if (!['localhost','127.0.0.1','[::1]'].includes(location.hostname)) {
    document.body.textContent='编辑功能只在本机预览中开放。'; return;
  }
  const $=id=>document.getElementById(id), frame=$('canvas'), key='earth-layout-drafts-v1';
  const route=$('route'), size=$('size');
  let baseline=new Map(), selected=null, ready=false, dirty=false, browsing=false, phase='', token=0;
  let drafts={},unresolvedEdits=[],unresolvedAdditions=[];
  try { drafts=JSON.parse(localStorage.getItem(key)||'{}'); } catch { /* corrupt drafts are not applied */ }

  function backupDrafts(reason,contents=drafts){
    if(!Object.keys(contents).length)return;
    const historyKey='earth-layout-draft-history-v1';
    const raw=JSON.stringify(contents);
    let history=[];try{history=JSON.parse(localStorage.getItem(historyKey)||'[]');}catch{}
    if(history.at(-1)?.raw===raw)return;
    history.push({at:new Date().toISOString(),reason,raw});
    localStorage.setItem(historyKey,JSON.stringify(history.slice(-3)));
  }
  try{backupDrafts('打开编辑器前备份');}catch{/* Existing drafts are never cleared if backup storage is full. */}
  const initial=new URLSearchParams(location.search).get('page')||'/';
  if (/^\/(?:about|skills|quests|operations|writing(?:\/[a-z0-9-]+)?|videos(?:\/[a-z0-9-]+)?)?$/.test(initial)) {
    if (![...route.options].some(o=>o.value===initial)) route.add(new Option('当前作品',initial));
    route.value=initial;
  }
  size.value=innerWidth<700?'mobile':'desktop';
  const scope=()=>route.value+'|'+size.value;
  function status(text,error=false){$('status').textContent=text;$('status').dataset.error=String(error)}
  function engine(){return frame.contentWindow}
  function isText(el){return el.hasAttribute('data-earth-edit-text') || (el.namespaceURI==='http://www.w3.org/1999/xhtml' && el.children.length===0 && !/^(IMG|SVG|PATH|CANVAS|INPUT|TEXTAREA|SELECT|OPTION|BR|HR|VIDEO|IFRAME)$/.test(el.tagName) && !!el.textContent.trim())}
  // Keep existing element IDs/selectors stable so previously saved drafts still match.
  function prepareTextRuns(doc){
    const parents=[...doc.querySelectorAll('#root *')];
    for(const el of parents){
      if(el.namespaceURI!=='http://www.w3.org/1999/xhtml'||el.matches('input,textarea,select,option,script,style')||!el.children.length)continue;
      const parent=baseline.get(el.dataset.earthEditId);if(!parent)continue;
      [...el.childNodes].forEach((node,index)=>{
        if(node.nodeType!==3||!node.textContent.trim())return;
        const run=doc.createElement('earth-text');
        run.dataset.earthEditText='';run.dataset.earthEditId=el.dataset.earthEditId+'t'+index;
        node.replaceWith(run);run.append(node);
        baseline.set(run.dataset.earthEditId,{selector:parent.selector+'::text('+index+')',values:capture(run)});
      });
    }
  }
  function refreshTextList(){
    const list=$('text-list'),query=$('text-search').value.trim().toLowerCase();list.replaceChildren();
    if(!ready)return;
    const doc=frame.contentDocument;
    const candidates=[...doc.querySelectorAll('[data-earth-edit-text]')].filter(el=>{
      if(el.closest('.sr-only,[aria-hidden="true"],select'))return false;
      const rect=el.getBoundingClientRect();
      return rect.width>1&&rect.height>1&&el.textContent.trim()&&el.textContent.toLowerCase().includes(query);
    });
    for(const el of candidates){const option=document.createElement('option');option.value=el.dataset.earthEditId;option.textContent=el.textContent.trim().replace(/\s+/g,' ').slice(0,100);list.append(option)}
    $('text-count').textContent=candidates.length?'找到 '+candidates.length+' 段文案，点击一项进行修改。':'没有匹配的文字。图片内文字需要替换图片素材。';
    list.selectedIndex=-1;
  }
  $('text-search').oninput=refreshTextList;
  $('text-list').onchange=()=>{
    const el=frame.contentDocument.querySelector('[data-earth-edit-id="'+$('text-list').value+'"]');
    if(!el)return;
    if(browsing)$('preview').click();
    el.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    engine().__earthSelect?.(el);syncSelection();$('text').focus();
    status('已选中这段文案，在右侧修改后点击“替换文字”。');
  };
  function capture(el){return {style:el.getAttribute('style')||'',text:isText(el)?el.textContent:null,src:el.tagName==='IMG'?el.getAttribute('src'):null,href:el.tagName==='A'?el.getAttribute('href'):null}}
  function selector(el){const parts=[];while(el && el.id!=='root'){const p=el.parentElement;if(!p)break;parts.unshift(el.tagName.toLowerCase()+':nth-child('+([...p.children].indexOf(el)+1)+')');el=p}return '#root > '+parts.join(' > ')}
function stableLocator(el){
    const doc=el.ownerDocument;
    let anchor=el.closest('.quest-card,.skill-equipment-card,.identity-card,.recent-update-card,.ops-case-card,.writing-card,.video-card');
    let prefix='';
    if(anchor){
      if(anchor.id)prefix='#'+CSS.escape(anchor.id);
      else{
        const kind=[...anchor.classList].find(c=>['quest-card','skill-equipment-card','identity-card','recent-update-card','ops-case-card','writing-card','video-card'].includes(c));
        const scope=anchor.closest('[id]:not(#root)');
        const peers=[...(scope||doc).querySelectorAll('.'+kind)];
        const index=peers.indexOf(anchor);
        const actual=(scope?'#'+CSS.escape(scope.id)+' ':'')+'.'+kind;
        // A selector plus index avoids coupling old card content to its outer page structure.
        prefix=actual+'@@'+index;
      }
    }else{anchor=el.closest('[id]:not(#root)');if(anchor)prefix='#'+CSS.escape(anchor.id);}
    if(!anchor)return null;
    const parts=[];let node=el;
    while(node&&node!==anchor){const parent=node.parentElement;if(!parent)return null;parts.unshift(node.tagName.toLowerCase()+':nth-child('+([...parent.children].indexOf(node)+1)+')');node=parent;}
    return {anchor:prefix,path:parts.join(' > ')};
  }
  function findStable(doc,locator){
    if(!locator?.anchor)return null;
    let anchor;
    const split=locator.anchor.lastIndexOf('@@');
    try{
      anchor=split>=0?doc.querySelectorAll(locator.anchor.slice(0,split))[Number(locator.anchor.slice(split+2))]:doc.querySelector(locator.anchor);
      return anchor?(locator.path?anchor.querySelector(':scope > '+locator.path):anchor):null;
    }catch{return null;}
  }
  let legacyLayout=null,isLegacyDraft=false;

  function patchFingerprint(patch,field,change){
    const value=JSON.stringify([patch.id,patch.selector,patch.tag,field,change.after]);
    let hash=2166136261;for(let i=0;i<value.length;i++){hash^=value.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return value.length+':'+(hash>>>0).toString(16);
  }
  const committedPromise=fetch('/editor-committed-edits.json').then(r=>r.ok?r.json():null).catch(()=>null);
  const legacyLayoutPromise=fetch('/editor-layout-legacy.json').then(r=>r.ok?r.json():null).catch(()=>null);
  function findDraftElement(doc,id,locator=null){
    if(locator)return findStable(doc,locator);
    if(isLegacyDraft&&id?.startsWith('e')&&legacyLayout?.entries[id]?.locator)return findStable(doc,legacyLayout.entries[id].locator);
    return doc.querySelector('[data-earth-edit-id="'+CSS.escape(id||'')+'"]');
  }
  function collect(){
    if(!ready)return [];
    engine().__earthFinishText?.();
    const edits=[];
    baseline.forEach((old,id)=>{
      const el=frame.contentDocument.querySelector('[data-earth-edit-id="'+id+'"]');if(!el)return;
      const now=capture(el),changes={};
      for(const field of ['style','text','src','href']) if(now[field]!==old.values[field])changes[field]={before:old.values[field],after:now[field]};
      if(Object.keys(changes).length)edits.push({id,selector:old.selector,stableLocator:old.stableLocator,tag:el.tagName,changes});
    });return edits;
  }

  const cardSelector='.quest-card,.ops-case-card,.skill-equipment-card,.recent-update-card,.writing-card,.video-card,.retro-window,article,[role="dialog"]';
  const blockedCopySelector='#root,.app,main,.route-view,.shared-world-pages,.profile-category,.topbar,.profile-category-nav,.taskbar';
  function copyTarget(below=false){
    if(!selected?.isConnected)return null;
    const target=below?(selected.closest(cardSelector)||selected):(selected.closest('svg')||selected);
    if(target.matches(blockedCopySelector)||target.contains(frame.contentDocument.querySelector('.topbar'))||target.querySelectorAll('*').length>1200)return null;
    return target;
  }
  function collectAdditions(){
    if(!ready)return [];
    return [...frame.contentDocument.querySelectorAll('#root [data-earth-edit-added]')]
      .filter(el=>!el.parentElement.closest('[data-earth-edit-added]'))
      .map(el=>({id:el.dataset.earthEditId,parentId:el.parentElement.id==='root'?'root':el.parentElement.dataset.earthEditId,nextId:el.nextElementSibling?.dataset.earthEditId||null,html:el.outerHTML}));
  }
  function newDraftItem(){
    const edits=collect();
    return {layoutVersion:'combined-profile-20261024',route:route.value,viewport:size.value,width:frame.clientWidth,savedAt:new Date().toISOString(),edits:[...edits,...unresolvedEdits],additions:[...collectAdditions(),...unresolvedAdditions]};
  }
  function sanitizeAddition(el){
    el.querySelectorAll('script,iframe,object,embed,base,meta,link,style').forEach(node=>node.remove());
    for(const node of [el,...el.querySelectorAll('*')]){
      node.removeAttribute('contenteditable');
      for(const attr of [...node.attributes]){
        if(/^on/i.test(attr.name)||attr.name==='srcdoc')node.removeAttribute(attr.name);
        if(/^(href|src|xlink:href|action|formaction)$/i.test(attr.name)&&/^\s*(javascript|vbscript):/i.test(attr.value))node.removeAttribute(attr.name);
      }
      if(node.tagName==='IMG')node.draggable=false;
    }
    return el;
  }
  function restoreAdditions(doc,items){
    let skipped=0;
    const knownIds=new Set([...doc.querySelectorAll('[data-earth-edit-id]')].map(el=>el.dataset.earthEditId));
    // Reverse document order ensures a later added sibling already exists when used as an insertion anchor.
    for(const item of [...items].reverse()){
      const parent=item.parentId==='root'?doc.getElementById('root'):findDraftElement(doc,item.parentId);
      if(!parent||typeof item.html!=='string'){skipped++;unresolvedAdditions.push(item);continue}
      const template=doc.createElement('template');template.innerHTML=item.html;
      const el=template.content.firstElementChild;
      if(!el||!el.hasAttribute('data-earth-edit-added')||el.dataset.earthEditId!==item.id||el.matches(blockedCopySelector)){skipped++;unresolvedAdditions.push(item);continue}
      const nodes=[el,...el.querySelectorAll('[data-earth-edit-id]')];
      const ids=nodes.map(node=>node.dataset.earthEditId);
      if(ids.some(id=>!id?.startsWith('dup-')||knownIds.has(id))||new Set(ids).size!==ids.length){skipped++;unresolvedAdditions.push(item);continue}
      sanitizeAddition(el);
      const next=item.nextId?findDraftElement(doc,item.nextId):null;
      parent.insertBefore(el,next?.parentElement===parent?next:null);
      ids.forEach(id=>knownIds.add(id));
    }
    return skipped;
  }
  function duplicateSelection(below=false,options={}){
    if(!ready||browsing)return;
    engine().__earthFinishText?.();
    const source=options.source||copyTarget(below);
    if(!source)return status('请先选中一个图标、文字框或卡片。整页和导航不能复制。',true);
    const doc=frame.contentDocument, copy=sanitizeAddition(source.cloneNode(true));
    const prefix='dup-'+crypto.randomUUID();
    const originals=[source,...source.querySelectorAll('*')],copies=[copy,...copy.querySelectorAll('*')],idMap=new Map();
    originals.forEach((node,index)=>{
      const clone=copies[index];
      if(!clone)return;
      clone.dataset.earthEditId=prefix+'-'+index;
      clone.removeAttribute('data-earth-edit-added');
      if(node.id){const id=prefix+'-dom-'+index;idMap.set(node.id,id);clone.id=id;}
    });
    copy.dataset.earthEditAdded=below?'below':'copy';
    for(const node of copies)for(const attr of [...node.attributes]){
      let value=attr.value;
      idMap.forEach((to,from)=>{
        value=value.replaceAll('url(#'+from+')','url(#'+to+')');
        if(['href','xlink:href'].includes(attr.name)&&value==='#'+from)value='#'+to;
        if(['for','aria-labelledby','aria-describedby','aria-controls'].includes(attr.name))value=value.split(' ').map(id=>id===from?to:id).join(' ');
      });
      if(value!==attr.value)node.setAttribute(attr.name,value);
    }
    const parent=options.target||source.parentElement,computed=options.computed||engine().getComputedStyle(source),layout=engine().getComputedStyle(parent);
    const placementAnchor=options.anchor||source;
    let before=options.target?(options.before||null):source.nextSibling;
    if(below){
      copy.style.setProperty('position','relative','important');
      for(const prop of ['top','left','bottom','right'])copy.style.setProperty(prop,'auto','important');
      copy.style.setProperty('transform','none','important');
      copy.style.setProperty('translate','none','important');
      copy.style.setProperty('grid-row','auto','important');
      copy.style.setProperty('order','0','important');
      if(layout.display.includes('grid')){
        const tracks=layout.gridTemplateColumns.match(/[^\s]+/g)||[];
        const box=placementAnchor.getBoundingClientRect(),parentBox=parent.getBoundingClientRect();
        const gap=parseFloat(layout.columnGap)||0,pad=parseFloat(layout.paddingLeft)||0;
        let cursor=parentBox.left+pad,col=1;
        for(let index=0;index<tracks.length;index++){if(box.left>=cursor-3)col=index+1;cursor+=(parseFloat(tracks[index])||0)+gap;}
        copy.style.setProperty('grid-column',String(col),'important');
        before=null;
      }else if(layout.display.includes('flex')&&layout.flexDirection.startsWith('row')){
        engine().__earthRecordChange(parent,'flexWrap','wrap','为下方副本换行');
        copy.style.setProperty('flex-basis','100%');
        copy.style.setProperty('flex-shrink','0');
        copy.style.setProperty('margin-top','14px');
      }else{
        copy.style.setProperty('display','block');
        copy.style.setProperty('margin-top','14px');
      }
    }else if(options.point){
      const bounds=parent.getBoundingClientRect(),parentStyle=engine().getComputedStyle(parent);
      if(parentStyle.position==='static')engine().__earthRecordChange(parent,'position','relative','建立粘贴定位');
      const width=Math.min(options.width||24,Math.max(20,parent.clientWidth-8)),height=options.height||24;
      copy.style.setProperty('position','absolute','important');
      copy.style.setProperty('margin','0','important');
      copy.style.setProperty('transform','none','important');
      copy.style.setProperty('translate','none','important');
      copy.style.setProperty('inset','auto','important');
      copy.style.setProperty('left',Math.max(0,Math.min(options.point.x-bounds.left+parent.scrollLeft-parseFloat(parentStyle.borderLeftWidth||0)-width/2,parent.clientWidth-width))+'px','important');
      copy.style.setProperty('top',Math.max(0,options.point.y-bounds.top+parent.scrollTop-parseFloat(parentStyle.borderTopWidth||0)-height/2)+'px','important');
      copy.style.setProperty('width',width+'px','important');
      copy.style.setProperty('height',height+'px','important');
      copy.style.setProperty('z-index','5');
      copy.style.setProperty('pointer-events','auto','important');
      if(source.namespaceURI==='http://www.w3.org/2000/svg')copy.style.setProperty('display','block');
    }else if(['absolute','fixed'].includes(computed.position)){
      const values=computed.translate==='none'?[0,0]:computed.translate.split(' ').map(parseFloat);
      copy.style.setProperty('translate',((values[0]||0)+24)+'px '+((values[1]||0)+24)+'px','important');
    }
    if(!engine().__earthInsertElement?.(copy,parent,before,below?'在下方新增副本':'复制元素'))return status('复制未完成，请刷新编辑器后重试。',true);
    dirty=true;syncSelection();refreshTextList();
    copy.scrollIntoView({block:options.point?'nearest':'center',inline:'nearest',behavior:'instant'});
    status(below?'已在下方新增副本，可单独修改。记得保存本机草稿。':'已复制并选中新元素，可拖动紫框移动。记得保存本机草稿。');
  }

  let clipboard=null,dropTarget=null;
  function copyToClipboard(){
    if(!ready||browsing)return;
    engine().__earthFinishText?.();
    const source=copyTarget(false);
    if(!source)return status('请先选中要复制的图标、文字框或卡片。',true);
    const bounds=source.getBoundingClientRect(),style=engine().getComputedStyle(source);
    clipboard={node:source.cloneNode(true),width:bounds.width,height:bounds.height,isCard:source.matches(cardSelector),computed:{position:style.position,translate:style.translate}};
    const name=clipboard.isCard?'卡片':source.closest('svg')||source.matches('img')?'图标 / 图片':'元素';
    $('copy-chip').hidden=false;$('copy-chip').draggable=true;
    $('copy-chip').textContent='⠿ 拖动待粘贴的'+name+'到画布';
    $('paste-element').disabled=false;
    status('已复制。现在点击目标位置后点“粘贴到这里”，或拖动右侧待粘贴副本到画布。');
  }
  function pasteContainer(target){
    if(!target?.closest('#root'))return null;
    let parent=target.closest(cardSelector)||target;
    if(parent.namespaceURI!=='http://www.w3.org/1999/xhtml'||parent.matches('img,br,hr,input,textarea,select,video,canvas,earth-text')||isText(parent))parent=parent.parentElement;
    if(!parent||parent.matches(blockedCopySelector)||parent.closest('.topbar,.profile-category-nav,.taskbar'))return null;
    return parent;
  }
  function pasteClipboard(target=selected,point=null){
    if(!clipboard||!ready||browsing)return status('请先点“复制元素”。',true);
    const parent=pasteContainer(target);
    if(!parent)return status('请点击一张内容卡片或内容区域后粘贴；导航栏不能作为粘贴位置。',true);
    const anchor=target.closest(cardSelector),isCard=clipboard.isCard;
    const destination=isCard&&anchor?anchor.parentElement:parent;
    const bounds=parent.getBoundingClientRect();
    duplicateSelection(isCard,{source:clipboard.node,target:destination,anchor:anchor||parent,before:anchor?.nextSibling||null,point:isCard?null:(point||{x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2}),width:clipboard.width,height:clipboard.height,computed:clipboard.computed});
    status(isCard?'已把卡片副本放到内容下方，可继续修改。':'已粘贴到目标位置。副本已选中，可拖动紫框微调位置、拖动角点缩放。');
  }
  function clearDropTarget(){
    dropTarget?.removeAttribute('data-earth-drop-target');dropTarget=null;
  }
  function bindPasting(doc){
    const style=doc.createElement('style');
    style.textContent='[data-earth-drop-target]{outline:3px dashed #ac48f7!important;outline-offset:-3px}';
    doc.head.append(style);
    doc.addEventListener('dragover',event=>{
      if(!clipboard||browsing||!event.dataTransfer?.types.includes('application/x-earth-copy'))return;
      const target=pasteContainer(event.target);if(!target)return;
      event.preventDefault();event.dataTransfer.dropEffect='copy';
      if(dropTarget!==target){clearDropTarget();dropTarget=target;target.setAttribute('data-earth-drop-target','');}
    },true);
    doc.addEventListener('drop',event=>{
      if(!clipboard||!event.dataTransfer?.types.includes('application/x-earth-copy'))return;
      event.preventDefault();event.stopPropagation();const target=dropTarget||event.target;
      clearDropTarget();pasteClipboard(target,{x:event.clientX,y:event.clientY});
    },true);
    doc.addEventListener('dragleave',event=>{if(!event.relatedTarget)clearDropTarget()});
    const shortcut=event=>{
      if(!ready||browsing||!(event.ctrlKey||event.metaKey)||event.altKey)return;
      const active=event.target;
      if(active?.isContentEditable||active?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
      if(event.key.toLowerCase()==='c'&&selected&&!doc.defaultView.getSelection()?.toString()){event.preventDefault();copyToClipboard();}
      if(event.key.toLowerCase()==='v'&&clipboard){event.preventDefault();pasteClipboard();}
    };
    doc.addEventListener('keydown',shortcut);
  }
  $('copy-element').onclick=copyToClipboard;
  $('paste-element').onclick=()=>pasteClipboard();
  $('copy-chip').ondragstart=event=>{
    if(!clipboard){event.preventDefault();return;}
    event.dataTransfer.effectAllowed='copy';event.dataTransfer.setData('application/x-earth-copy','copy');
    event.dataTransfer.setData('text/plain','地球在线：待粘贴副本');
  };
  $('copy-chip').ondragend=clearDropTarget;

  $('duplicate-element').onclick=()=>duplicateSelection(false);
  $('duplicate-below').onclick=()=>duplicateSelection(true);
  $('select-card').onclick=()=>{
    const target=selected?.closest(cardSelector);
    if(!target)return status('没有找到外层卡片，可使用悬浮面板的“↑ 父级”。');
    engine().__earthSelect?.(target);syncSelection();
    status('已选中整张卡片，点击“在下方新增副本”即可复制。');
  };

  function persist(){
    if(!ready){status('画面还在加载，请稍候。',true);return false}
    const item=newDraftItem();
    let live=drafts;try{live=JSON.parse(localStorage.getItem(key)||'{}');}catch{}
    const next={...live,[scope()]:item};
    try{backupDrafts('保存前保留上一版',live);localStorage.setItem(key,JSON.stringify(next));drafts=next;dirty=false;status('已保存本机草稿 · '+item.edits.length+' 处修改 / '+item.additions.length+' 个副本（尚未发布）');return true}
    catch{status('浏览器存储不足，未保存。请点击“导出修改”备份。',true);return false}
  }
  const panelValues={text:'',src:'',href:''};
  function syncSelection(force=false){
    const previous=selected;
    selected=engine().__earthGetSelection?.()||null;
    const changed=previous!==selected;
    const img=selected?.matches('img,.memory-art')?selected:null;
    const anchor=selected?.closest('a');
    const text=selected&&isText(selected);
    $('duplicate-element').disabled=!copyTarget(false)||browsing;
    $('copy-element').disabled=!copyTarget(false)||browsing;
    $('paste-element').disabled=!clipboard||!selected||browsing;
    $('duplicate-below').disabled=!copyTarget(true)||browsing;
    $('select-card').disabled=!selected?.closest(cardSelector)||browsing;
    $('selection').textContent=selected?'已选中：'+selected.tagName.toLowerCase()+' '+(selected.textContent||selected.getAttribute('alt')||'').slice(0,35):'尚未选择元素';
    for(const id of ['text','apply-text'])$(id).disabled=!text;
    for(const id of ['src','apply-src','upload'])$(id).disabled=!img;
    for(const id of ['href','apply-href'])$(id).disabled=!anchor;
    const values={text:text?selected.textContent:'',src:img?(img.getAttribute('src')||engine().getComputedStyle(img).backgroundImage.replace(/^url\(["']?|["']?\)$/g,'')):'',href:anchor?.getAttribute('href')||''};
    for(const [id,value]of Object.entries(values)){
      // Scroll/selection notifications must never erase text the user is typing in the inspector.
      if(changed||force===true||$(id).value===panelValues[id]){
        $(id).value=value;panelValues[id]=value;
      }
    }
  }
  function validURL(value,image=false){
    if(!value.trim())return false;
    try{const u=new URL(value,location.origin);return ['http:','https:'].includes(u.protocol)||(!image&&['mailto:','tel:'].includes(u.protocol))}catch{return false}
  }
  function apply(prop,value,el){
    if(!el)return;
    engine().__earthRecordChange(el,prop,value,prop==='innerText'?'替换文字':prop==='src'?'替换图片':'替换链接');
    dirty=true;syncSelection(true);refreshTextList();status('修改已应用，记得保存本机草稿。');
  }
  $('apply-text').onclick=()=>apply('innerText',$('text').value,selected);
  function replaceImage(value,el){if(!el)return;if(el.tagName==='IMG')apply('src',value,el);else apply('background','url('+JSON.stringify(value)+') center / cover no-repeat',el)}
  $('apply-src').onclick=()=>{const v=$('src').value.trim();if(!validURL(v,true))return status('请输入图片的 http(s) 地址或 /assets/ 路径。',true);replaceImage(v,selected)};
  $('apply-href').onclick=()=>{const v=$('href').value.trim();if(!validURL(v))return status('请输入网址、站内路径、邮箱或电话链接。',true);apply('href',v,selected?.closest('a'))};
  $('upload').onchange=async()=>{
    const file=$('upload').files[0], target=selected;
    if(!file||!target||!target.matches('img,.memory-art'))return;
    if(!['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)||file.size>1024*1024)return status('请选择 1 MB 以内的 PNG、JPG、WebP 或 GIF 图片。',true);
    const reader=new FileReader();reader.onload=()=>replaceImage(String(reader.result),target);reader.onerror=()=>status('图片读取失败，请重试。',true);reader.readAsDataURL(file);$('upload').value='';
  };
  $('save').onclick=persist;
  $('export').onclick=()=>{
    if(!ready)return;
    const all={...drafts,[scope()]:newDraftItem()};
    const payload={format:'earth-online-layout-drafts',version:2,note:'视觉修改提案，需写回 React 源码并验证全部路由及响应式布局。',pages:all};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='地球在线-页面修改-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('已导出修改文件。发给我即可继续落实到正式网页。');
  };
  $('undo').onclick=()=>{engine().__canvascodeUndo?.();syncSelection(true);dirty=true};
  $('redo').onclick=()=>{engine().__canvascodeRedo?.();syncSelection(true);dirty=true};
  $('reset').onclick=()=>{if(!ready||!confirm('恢复当前页面、当前画幅的原稿？其他页面的草稿会保留。'))return;const next={...drafts};delete next[scope()];try{localStorage.setItem(key,JSON.stringify(next));drafts=next;dirty=false;load()}catch{status('无法清除本机草稿，请检查浏览器存储权限。',true)}};
  window.addEventListener('earth-reset-request',()=>$('reset').click());
  $('toggle-panel').onclick=()=>{$('panel').hidden=!$('panel').hidden;$('toggle-panel').textContent=$('panel').hidden?'显示面板':'收起面板'};
  $('preview').onclick=()=>{if(!ready)return;engine().__earthFinishText?.();browsing=!browsing;engine().__canvascodeSetMode(!browsing);$('panel').hidden=browsing;$('preview').textContent=browsing?'继续编辑':'预览草稿';$('toggle-panel').textContent=browsing?'显示面板':'收起面板';status(browsing?'正在预览静态草稿；切换页面请使用上方菜单。':'编辑模式已开启。')};
  function load(){
    ready=false;selected=null;baseline=new Map();browsing=false;unresolvedEdits=[];unresolvedAdditions=[];token++;phase='live';
    $('preview').textContent='预览草稿';document.body.dataset.size=size.value;
    $('back').href=route.value;history.replaceState(null,'','/editor.html?page='+encodeURIComponent(route.value));
    status('正在准备 '+route.selectedOptions[0].text+' 的编辑画面…');
    frame.removeAttribute('srcdoc');frame.src=route.value+'?editor-source=1';
    for(const id of ['text','src','href','upload','apply-text','apply-src','apply-href','duplicate-element','duplicate-below','select-card','copy-element','paste-element'])$(id).disabled=true;
  }
  let previousRoute=route.value, previousSize=size.value;
  function changePage(){const nextRoute=route.value,nextSize=size.value;route.value=previousRoute;size.value=previousSize;if(dirty&&!persist()){return}route.value=nextRoute;size.value=nextSize;previousRoute=nextRoute;previousSize=nextSize;load()}
  route.onchange=changePage;size.onchange=changePage;
  frame.onload=async()=>{
    if(phase!=='live')return;
    const currentToken=token;
    try{
      const doc=frame.contentDocument;
      if(!doc.getElementById('root'))throw Error('页面未加载成功');
      for(let i=0;i<50;i++){
        const hasContent=doc.querySelector('#root main');
        const stage=doc.querySelector('.player-character-stage');
        if(hasContent&&(!stage||doc.querySelector('.character-ready')))break;
        await new Promise(r=>setTimeout(r,100));if(currentToken!==token)return;
      }
      await new Promise(r=>setTimeout(r,850));if(currentToken!==token)return;
      const root=doc.getElementById('root').cloneNode(true);
      // Use the existing fallback portrait after removing the live WebGL renderer.
      root.querySelectorAll('canvas').forEach(canvas=>canvas.remove());
      root.querySelectorAll('.character-ready').forEach(el=>el.classList.remove('character-ready'));
      root.querySelectorAll('script,iframe').forEach(el=>el.remove());
      root.querySelectorAll('*').forEach(el=>{if(isText(el))el.setAttribute('data-earth-edit-text','')});
      root.querySelectorAll('img').forEach(el=>el.draggable=false);
      root.querySelectorAll('*').forEach(el=>{for(const attr of [...el.attributes])if(attr.name.startsWith('on'))el.removeAttribute(attr.name)});
      const styles=[...doc.querySelectorAll('link[rel="stylesheet"],style')].map(el=>el.outerHTML).join('');
      phase='snapshot';
      frame.srcdoc='<!doctype html><html lang="zh-CN"><head><base href="'+location.origin+'/"><meta name="viewport" content="width=device-width,initial-scale=1">'+styles+'<style>html{scroll-behavior:auto!important}*,*::before,*::after{animation-play-state:paused!important;transition:none!important}[data-earth-edit-text],#root img,#root .memory-art{pointer-events:auto!important}</style></head><body>'+root.outerHTML+'<script src="/vendor/canvascode/tweak-engine.js"><\/script><script>parent.dispatchEvent(new Event("earth-snapshot-ready"))<\/script></body></html>';
    }catch(e){status('无法加载编辑画面：'+e.message+'。请返回网站后重试。',true)}
  };
  window.addEventListener('earth-snapshot-ready',async()=>{
    if(phase!=='snapshot')return;
    const doc=frame.contentDocument;
    doc.querySelectorAll('#root *').forEach((el,i)=>{const id='e'+i;el.dataset.earthEditId=id;baseline.set(id,{selector:selector(el),values:capture(el)})});
    prepareTextRuns(doc);
    for(const [id,entry]of baseline){const el=doc.querySelector('[data-earth-edit-id="'+id+'"]');entry.stableLocator=el?stableLocator(el):null;}
    legacyLayout=await legacyLayoutPromise;
    isLegacyDraft=drafts[scope()]?.layoutVersion!=='combined-profile-20261024';

    const committedData=await committedPromise;
    const committedFields=new Set((committedData?.fields||[]).map(item=>item.fingerprint));
    let skipped=0,committedCount=0;
    for(const patch of drafts[scope()]?.edits||[]){
      let el=findDraftElement(doc,patch.id,patch.stableLocator);
      const pending={};
      for(const [field,change]of Object.entries(patch.changes)){
        if(committedFields.has(patchFingerprint(patch,field,change))){committedCount++;continue;}
        if(field==='text'&&(!el||el.tagName!==patch.tag||![change.before,change.after].includes(capture(el).text))){
          const candidates=[...doc.querySelectorAll(patch.tag==='EARTH-TEXT'?'earth-text':patch.tag)]
            .filter(node=>isText(node)&&[change.before,change.after].includes(node.textContent));
          if(candidates.length===1)el=candidates[0];
        }
        if(!el||el.tagName!==patch.tag){pending[field]=change;continue;}
        const now=capture(el)[field];
        if(now===change.after)continue;
        if(now!==change.before){pending[field]=change;continue;}
        if(field==='text'&&isText(el))el.textContent=change.after;
        else if(['style','src','href'].includes(field)){
          if(change.after===null)el.removeAttribute(field);else el.setAttribute(field,change.after);
        }else pending[field]=change;
      }
      if(Object.keys(pending).length){skipped++;unresolvedEdits.push({...patch,changes:pending,unresolved:true});}
    }
    skipped+=restoreAdditions(doc,drafts[scope()]?.additions||[]);
    bindPasting(doc);
    engine().addEventListener('canvascode:elementSelected',syncSelection);
    engine().addEventListener('canvascode:stateChanged',()=>{if(ready){dirty=true;syncSelection();refreshTextList()}});
    doc.addEventListener('click',e=>{if(!engine().__aiVisualTweakActive&&e.target.closest('a')){e.preventDefault();status('这是静态草稿预览。用上方菜单切换页面，返回网站可体验完整交互。')}});
    ready=true;dirty=false;syncSelection();refreshTextList();status(skipped?'已打开；'+skipped+' 处旧草稿暂未匹配，但仍完整保留，保存和导出也不会丢失。':committedCount?'编辑已就绪 · '+committedCount+' 项保存内容已写回正式网页。':'编辑已就绪 · 双击文字，或在右侧“查找文案”中选择。');
    const recovery=$('draft-recovery'),recoveryList=$('unresolved-list');
    recovery.hidden=skipped===0;recoveryList.replaceChildren();
    for(const patch of unresolvedEdits){
      const li=document.createElement('li');
      const text=patch.changes.text?.after;
      li.textContent=text?String(text).slice(0,100):'原 '+patch.tag+' 元素的'+Object.keys(patch.changes).join('、')+'修改';
      recoveryList.append(li);
    }
  });
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});
  load();
})();

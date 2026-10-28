// The editing workspace is available only on this computer's local preview.
if (['localhost','127.0.0.1','[::1]'].includes(location.hostname) && window.self === window.top) {
  const link=document.createElement('a');
  link.textContent='✎ 编辑页面';
  link.href='/editor.html?page='+encodeURIComponent(location.pathname);
  link.setAttribute('data-canvascode-ignore','');
  link.style.cssText='position:fixed;right:16px;bottom:57px;z-index:1000;padding:9px 15px;border:1px solid #b8d8ff;border-radius:8px;background:linear-gradient(#f1faff,#b4d9ff);color:#123c78;font:600 14px system-ui;box-shadow:0 3px 15px #00357255;text-decoration:none';
  link.addEventListener('click',()=>{link.href='/editor.html?page='+encodeURIComponent(location.pathname)});
  document.body.append(link);
}

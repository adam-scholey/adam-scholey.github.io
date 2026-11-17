(function(){
  var root=document.documentElement,KEY='portfolio-theme',stored=null;
  try{stored=localStorage.getItem(KEY)}catch(e){}
  var prefers=window.matchMedia?window.matchMedia('(prefers-color-scheme: dark)').matches:false;
  if(stored?stored==='dark':prefers)root.setAttribute('data-theme','dark');
  function toggle(){
    var on=root.getAttribute('data-theme')==='dark';
    if(on)root.removeAttribute('data-theme');else root.setAttribute('data-theme','dark');
    try{localStorage.setItem(KEY,on?'light':'dark')}catch(e){}
  }
  function bind(){
    var b=document.getElementById('theme-toggle');
    if(b)b.addEventListener('click',toggle);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();

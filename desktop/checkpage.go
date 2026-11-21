package main

// checkPage tests, inside the window's engine, the web features MindSift relies on (spike only).
const checkPage = `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>MindSift – Prüfseite</title>
<style>
 body{font-family:system-ui,sans-serif;background:#16181d;color:#e6e6e6;margin:0;padding:24px}
 table{border-collapse:collapse;width:100%;max-width:980px} td{padding:6px 10px;border-bottom:1px solid #2a2e35;vertical-align:top}
 td:first-child{width:260px;color:#b8bcc2} .ok{color:#7ee2a8} .bad{color:#ff8a8a} .warn{color:#ffd27a}
 button{background:#6d5dfc;color:#fff;border:0;border-radius:6px;padding:6px 12px;margin:2px 6px 2px 0;cursor:pointer}
 #paste{border:1px dashed #555;padding:14px;margin:8px 0;border-radius:8px;max-width:940px}
 .drag{display:inline-block;padding:8px 12px;margin:4px;background:#2a2e35;border-radius:6px;cursor:grab}
 #drop{border:1px dashed #555;padding:14px;margin:8px 0;border-radius:8px;max-width:940px;min-height:30px}
 a{color:#a99cff} code{color:#c9c9ff}
</style></head><body>
<h2>Prüfseite: Web-Funktionen dieses Fensters</h2>
<p><a href="/__desktop/start">← Startseite</a> · <a href="/">MindSift (lokal)</a></p>
<table id="t"></table>
<h3>Von Hand</h3>
<p><button id="mic">Mikrofon + Aufnahme (3 s)</button><button id="notif">Benachrichtigung zeigen</button><button id="pk">Passkey anlegen (Test)</button><button id="clip">Zwischenablage lesen</button></p>
<div id="paste" contenteditable="true">Hier ein Bild oder Text einfügen (Strg+V) …</div>
<div><span class="drag" draggable="true">Zieh mich A</span><span class="drag" draggable="true">Zieh mich B</span></div>
<div id="drop">… hierher ziehen (Drag &amp; Drop), auch Dateien aus dem Dateimanager</div>
<script>
const t=document.getElementById('t');
function row(name,state,detail){let tr=document.getElementById('r-'+name);if(!tr){tr=document.createElement('tr');tr.id='r-'+name;t.appendChild(tr)}
 const cls=state===true?'ok':state===false?'bad':'warn';const sym=state===true?'✔':state===false?'✘':'…';
 tr.innerHTML='<td>'+name+'</td><td class="'+cls+'">'+sym+' '+(detail||'')+'</td>'}
row('User-Agent',null,navigator.userAgent);
row('Ursprung (Origin)',null,location.origin+' · isSecureContext='+window.isSecureContext);
row('localStorage',(()=>{try{localStorage.setItem('x','1');return localStorage.getItem('x')==='1'}catch(e){return false}})());
(function(){try{const r=indexedDB.open('ms-check',1);r.onupgradeneeded=()=>r.result.createObjectStore('s');
 r.onsuccess=()=>{const tx=r.result.transaction('s','readwrite');tx.objectStore('s').put('v','k');tx.oncomplete=()=>row('IndexedDB',true,'schreiben/lesen geht')};
 r.onerror=()=>row('IndexedDB',false,String(r.error))}catch(e){row('IndexedDB',false,String(e))}})();
row('Service Worker (API)', 'serviceWorker' in navigator, 'serviceWorker' in navigator?'vorhanden':'fehlt (Offline im Server-Modus bräuchte Ersatz)');
if('serviceWorker' in navigator){navigator.serviceWorker.register('/__desktop/sw-test.js').then(()=>row('Service Worker hier registrieren',true,'geht auf diesem Ursprung')).catch(e=>row('Service Worker hier registrieren',null,'nicht auf diesem Ursprung: '+e.message+' (für lokal unwichtig; im Server-Modus läuft er über https)'))}
row('WebSocket (API)', 'WebSocket' in window, 'im lokalen Modus nicht nutzbar (kein Port), MindSift fällt auf SSE/Long-Polling zurück');
(function(){if(!window.EventSource){row('SSE (EventSource)',false,'fehlt');return}const t0=Date.now();const got=[];const es=new EventSource('/__desktop/sse');
 es.onmessage=e=>{got.push(((Date.now()-t0)/1000).toFixed(1)+'s');row('SSE (gestreamt?)',null,'Ereignisse bei '+got.join(', '));if(got.length===5){es.close();
 const spread=parseFloat(got[4])-parseFloat(got[0]);row('SSE (gestreamt?)',spread>1.5,'Ereignisse bei '+got.join(', ')+(spread>1.5?' – kommt Stück für Stück':' – kommt erst am Ende (gepuffert)'))}};
 es.onerror=()=>{if(got.length<5){row('SSE (gestreamt?)',got.length?null:false,'Fehler nach '+got.length+' Ereignissen');es.close()}}})();
(function(){const t0=Date.now();fetch('/__desktop/slow').then(r=>r.text()).then(x=>row('Lange Anfrage (Long-Polling)',x==='ok','Antwort nach '+((Date.now()-t0)/1000).toFixed(1)+' s')).catch(e=>row('Lange Anfrage (Long-Polling)',false,String(e)))})();
(function(){const fd=new FormData();fd.append('file',new Blob([new Uint8Array(300000)]),'x.bin');
 fetch('/__desktop/echo',{method:'POST',body:fd}).then(r=>r.json()).then(j=>row('Upload (FormData mit Datei)',j.bytes>300000,j.bytes+' Bytes angekommen')).catch(e=>row('Upload (FormData mit Datei)',false,String(e)))})();
(function(){fetch('/__desktop/echo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({a:'x'.repeat(5000)})}).then(r=>r.json()).then(j=>row('POST mit JSON',j.bytes>5000,j.bytes+' Bytes')).catch(e=>row('POST mit JSON',false,String(e)))})();
const css=[['oklch()','color','oklch(0.6 0.1 200)'],['color-mix()','color','color-mix(in oklab, red, blue)'],['Container Queries','container-type','inline-size'],[':has()','selector(:has(*))'],['Nesting','selector(&)']];
row('CSS (Tailwind 4 braucht das)',css.every(c=>c.length===3?CSS.supports(c[1],c[2]):CSS.supports(c[1])),css.map(c=>c[0]+(c.length===3?CSS.supports(c[1],c[2]):CSS.supports(c[1])?' ✔':' ✘')).join(' · '));
row('MediaRecorder', !!window.MediaRecorder, window.MediaRecorder?['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'].map(m=>m+(MediaRecorder.isTypeSupported(m)?' ✔':' ✘')).join(' · '):'fehlt');
row('getUserMedia', !!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia), 'Aufnahme unten von Hand testen');
row('Benachrichtigungen (Web)', 'Notification' in window, 'Notification' in window?'Erlaubnis: '+Notification.permission:'fehlt (dann über die Desktop-Schale)');
row('Push (Web Push)', 'PushManager' in window, 'PushManager' in window?'vorhanden':'fehlt (erwartet; Alarme kommen später über die Desktop-Schale)');
row('Zwischenablage (API)', !!(navigator.clipboard), navigator.clipboard?('read: '+!!navigator.clipboard.read+', write: '+!!navigator.clipboard.write+', writeText: '+!!navigator.clipboard.writeText):'fehlt');
if(window.PublicKeyCredential&&PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable){PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().then(v=>row('Passkeys (WebAuthn)',v?true:null,'API da, Plattform-Authenticator: '+v))}else row('Passkeys (WebAuthn)',false,'API fehlt');
row('Canvas 2D / OffscreenCanvas', !!document.createElement('canvas').getContext('2d'), 'OffscreenCanvas: '+('OffscreenCanvas' in window));
row('ResizeObserver / IntersectionObserver', 'ResizeObserver' in window && 'IntersectionObserver' in window);
row('structuredClone / Intl.Segmenter', 'structuredClone' in window, 'Intl.Segmenter: '+!!(window.Intl&&Intl.Segmenter));
document.getElementById('mic').onclick=async()=>{try{const s=await navigator.mediaDevices.getUserMedia({audio:true});const rec=new MediaRecorder(s);const parts=[];
 rec.ondataavailable=e=>parts.push(e.data);rec.onstop=()=>{s.getTracks().forEach(x=>x.stop());const b=new Blob(parts,{type:rec.mimeType});row('Aufnahme',b.size>0,b.size+' Bytes, '+rec.mimeType);
 const a=document.createElement('audio');a.controls=true;a.src=URL.createObjectURL(b);document.getElementById('mic').after(a)};rec.start();row('Aufnahme',null,'läuft …');setTimeout(()=>rec.stop(),3000)}catch(e){row('Aufnahme',false,String(e))}};
document.getElementById('notif').onclick=async()=>{try{const p=await Notification.requestPermission();row('Benachrichtigung',p==='granted',p);if(p==='granted')new Notification('MindSift',{body:'Testbenachrichtigung aus dem Fenster'})}catch(e){row('Benachrichtigung',false,String(e))}};
document.getElementById('pk').onclick=async()=>{try{const c=await navigator.credentials.create({publicKey:{challenge:crypto.getRandomValues(new Uint8Array(32)),rp:{name:'MindSift-Test'},user:{id:crypto.getRandomValues(new Uint8Array(16)),name:'test',displayName:'Test'},pubKeyCredParams:[{type:'public-key',alg:-7}],timeout:30000}});row('Passkey anlegen',!!c,'geklappt')}catch(e){row('Passkey anlegen',false,String(e))}};
document.getElementById('clip').onclick=async()=>{try{const items=await navigator.clipboard.read();row('Zwischenablage lesen',true,items.map(i=>i.types.join('/')).join(', ')||'leer')}catch(e){row('Zwischenablage lesen',false,String(e))}};
document.getElementById('paste').addEventListener('paste',e=>{const it=[...e.clipboardData.items];const img=it.find(i=>i.type.startsWith('image/'));row('Einfügen (Paste-Ereignis)',true,it.map(i=>i.kind+':'+i.type).join(', ')+(img?' – Bild erkannt':''))});
document.querySelectorAll('.drag').forEach(d=>d.addEventListener('dragstart',e=>e.dataTransfer.setData('text/plain',d.textContent)));
const drop=document.getElementById('drop');drop.addEventListener('dragover',e=>e.preventDefault());
drop.addEventListener('drop',e=>{e.preventDefault();const f=e.dataTransfer.files;row('Drag & Drop',true,f.length?f.length+' Datei(en): '+[...f].map(x=>x.name).join(', '):'Text: '+e.dataTransfer.getData('text/plain'))});
</script></body></html>`

const swTest = `self.addEventListener('install', () => self.skipWaiting());`

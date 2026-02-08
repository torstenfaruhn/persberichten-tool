(function(){
  const apiKeyEl = document.getElementById('apiKey');
  const fileInput = document.getElementById('fileInput');
  const btnUpload = document.getElementById('btnUpload');
  const btnEdit = document.getElementById('btnEdit');
  const btnDownload = document.getElementById('btnDownload');
  const btnDownloadLog = document.getElementById('btnDownloadLog');
  const snackbar = document.getElementById('snackbar');
  const signalsEl = document.getElementById('signals');
  const techlogEl = document.getElementById('techlog');
  const w015hintEl = document.getElementById('w015hint');

  const editorCard = document.getElementById('editorCard');
  const editorEl = document.getElementById('editor');
  const btnReprocess = document.getElementById('btnReprocess');
  const btnCloseEditor = document.getElementById('btnCloseEditor');

  const outputCard = document.getElementById('outputCard');
  const outputEl = document.getElementById('output');

  let lastCleaned = '';
  let lastOutput = '';
  let lastTechLog = '';

  function showBusy(on){
    snackbar.classList.toggle('show', !!on);
  }

  function setSignals(list){
    const hasW015 = Array.isArray(list) && list.some(s => s && s.code === 'W015');
    if(w015hintEl){ w015hintEl.hidden = !hasW015; }

    signalsEl.innerHTML = '';
    if(!list || list.length === 0){
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = 'Nog geen signalen.';
      signalsEl.appendChild(li);
      return;
    }
    list.forEach(s => {
      const li = document.createElement('li');
      const b = document.createElement('span');
      b.className = 'badge ' + (s.severity || 'info');
      b.textContent = s.code;
      li.appendChild(b);
      li.appendChild(document.createTextNode(' ' + s.message));
      signalsEl.appendChild(li);
    });
  }

  function setTechLog(t){
    lastTechLog = t || '';
    techlogEl.textContent = lastTechLog || '(nog geen log)';
    btnDownloadLog.disabled = !lastTechLog;
  }

  function gate(){
    const hasKey = apiKeyEl.value.trim().length > 0;
    btnUpload.disabled = !hasKey;
    btnEdit.disabled = !hasKey || !lastCleaned;
    btnDownload.disabled = !hasKey || !lastOutput;
  }

  apiKeyEl.addEventListener('keydown', (e) => { if(e.key === 'Enter') gate(); });
  apiKeyEl.addEventListener('input', gate);

  btnUpload.addEventListener('click', async () => {
    const apiKey = apiKeyEl.value.trim();
    const file = fileInput.files[0];
    if(!apiKey){
      setSignals([{code:'E000',message:'API-key is vereist om verder te gaan.',severity:'error'}]);
      return;
    }
    if(!file){
      setSignals([{code:'E002',message:'Onleesbaar bestand. Upload een ander bestand.',severity:'error'}]);
      return;
    }
    showBusy(true);
    try{
      const fd = new FormData();
      fd.append('apiKey', apiKey);
      fd.append('file', file);
      const r = await fetch('/api/process', {method:'POST', body: fd});
      const data = await r.json();
      setSignals(data.signals || []);
      setTechLog(data.tech_log || '');
      lastCleaned = data.cleaned_source || '';
      lastOutput = data.output_txt || '';
      outputEl.value = lastOutput || '';
      outputCard.hidden = !lastOutput;
      gate();
    }catch(err){
      setSignals([{code:'W010',message:'Technisch probleem tijdens verwerking. Probeer opnieuw.',severity:'warning'}]);
      setTechLog(String(err));
    }finally{
      showBusy(false);
    }
  });

  btnEdit.addEventListener('click', () => {
    editorEl.value = lastCleaned || '';
    editorCard.hidden = false;
    editorEl.focus();
  });

  btnCloseEditor.addEventListener('click', () => {
    editorCard.hidden = true;
  });

  btnReprocess.addEventListener('click', async () => {
    const apiKey = apiKeyEl.value.trim();
    const text = editorEl.value || '';
    showBusy(true);
    try{
      const r = await fetch('/api/reprocess', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({apiKey, text})
      });
      const data = await r.json();
      setSignals(data.signals || []);
      setTechLog(data.tech_log || '');
      lastCleaned = data.cleaned_source || text;
      lastOutput = data.output_txt || '';
      outputEl.value = lastOutput || '';
      outputCard.hidden = !lastOutput;
      gate();
    }catch(err){
      setSignals([{code:'W010',message:'Technisch probleem tijdens verwerking. Probeer opnieuw.',severity:'warning'}]);
      setTechLog(String(err));
    }finally{
      showBusy(false);
    }
  });

  btnDownload.addEventListener('click', async () => {
    if(!lastOutput) return;
    const r = await fetch('/api/download', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({content:lastOutput})
    });
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'nieuwsconcept.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  btnDownloadLog.addEventListener('click', async () => {
    if(!lastTechLog) return;
    const r = await fetch('/api/download-log', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({content:lastTechLog})
    });
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'technisch-log.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  gate();
})();

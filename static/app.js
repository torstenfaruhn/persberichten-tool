const apiKeyEl = document.getElementById('apiKey');
const fileEl = document.getElementById('file');
const processBtn = document.getElementById('processBtn');
const inlineError = document.getElementById('inlineError');
const snackbar = document.getElementById('snackbar');

const resultCard = document.getElementById('resultCard');
const outputEl = document.getElementById('output');
const signalsEl = document.getElementById('signals');
const metaEl = document.getElementById('meta');
const downloadBtn = document.getElementById('downloadBtn');
const copyBtn = document.getElementById('copyBtn');
const llmNote = document.getElementById('llmNote');

let lastOutput = "";

function showSnack(msg){
  snackbar.textContent = msg;
  snackbar.classList.add('show');
  setTimeout(()=>snackbar.classList.remove('show'), 1800);
}

function validateReady(){
  const ok = (apiKeyEl.value || '').trim().length > 0 && fileEl.files.length === 1;
  processBtn.disabled = !ok;
}
apiKeyEl.addEventListener('input', validateReady);
fileEl.addEventListener('change', validateReady);

processBtn.addEventListener('click', async () => {
  inlineError.textContent = "";
  resultCard.hidden = true;

  const apiKey = (apiKeyEl.value || '').trim();
  if(!apiKey){
    inlineError.textContent = "API-key is vereist om verder te gaan.";
    return;
  }
  if(fileEl.files.length !== 1){
    inlineError.textContent = "Upload precies één bestand.";
    return;
  }
  const file = fileEl.files[0];
  if(file.size > 10 * 1024 * 1024){
    inlineError.textContent = "Bestand is te groot (max 10 MB).";
    return;
  }

  showSnack("Bezig…");
  processBtn.disabled = true;

  try{
    const fd = new FormData();
    fd.append('api_key', apiKey);
    fd.append('file', file);

    const res = await fetch('/api/process', { method:'POST', body: fd });
    const data = await res.json();

    if(!data.ok){
      inlineError.textContent = `${data.error.code}: ${data.error.message}`;
      if(data.error.meta){
        metaEl.textContent = JSON.stringify(data.error.meta, null, 2);
      }
      return;
    }

    lastOutput = data.output_txt || "";
    outputEl.value = lastOutput;
    signalsEl.textContent = data.signals || "";
    metaEl.textContent = JSON.stringify(data.meta || {}, null, 2);
    llmNote.textContent = data.used_llm ? "LLM gebruikt voor herschrijving." : "LLM niet beschikbaar; fallback-herstructurering gebruikt.";
    resultCard.hidden = false;
    showSnack("Klaar");
  } catch(e){
    inlineError.textContent = "Onverwachte fout tijdens verwerken.";
  } finally{
    validateReady();
  }
});

downloadBtn.addEventListener('click', () => {
  if(!lastOutput) return;
  const blob = new Blob([lastOutput], {type:'text/plain;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'nieuwbericht.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

copyBtn.addEventListener('click', async () => {
  if(!lastOutput) return;
  try{
    await navigator.clipboard.writeText(lastOutput);
    showSnack("Gekopieerd");
  }catch(e){
    showSnack("Kopiëren mislukt");
  }
});

(() => {
  const apiKeyEl = document.getElementById("apiKey");
  const fileInput = document.getElementById("fileInput");
  const btnUpload = document.getElementById("btnUpload");
  const btnProcess = document.getElementById("btnProcess");
  const btnDownload = document.getElementById("btnDownload");
  const signalsBody = document.getElementById("signalsBody");
  const snackbar = document.getElementById("snackbar");
  const techHint = document.getElementById("techHint");
  const techLogEl = document.getElementById("techLog");

  let apiKey = "";
  let selectedFile = null;
  let outputTxt = "";
  let lastTechLog = null;

  function setSignals(lines) {
    if (!lines || lines.length === 0) {
      signalsBody.textContent = "Geen meldingen.";
      return;
    }
    const ul = document.createElement("ul");
    for (const line of lines) {
      const li = document.createElement("li");
      li.textContent = line;
      ul.appendChild(li);
    }
    signalsBody.innerHTML = "";
    signalsBody.appendChild(ul);
  }

  function showSnackbar(on) {
    if (on) snackbar.classList.add("show");
    else snackbar.classList.remove("show");
  }

  function setTechLogVisible(visible) {
    techHint.hidden = !visible;
    techLogEl.hidden = !visible;
    if (visible && lastTechLog) {
      techLogEl.textContent = JSON.stringify(lastTechLog, null, 2);
    }
  }

  function updateButtons() {
    const hasKey = apiKey.length > 0;
    btnUpload.disabled = !hasKey;
    btnProcess.disabled = !hasKey || !selectedFile;
    btnDownload.disabled = !outputTxt;
  }

  apiKeyEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      apiKey = apiKeyEl.value.trim();
      if (!apiKey) {
        setSignals(["API-key is vereist om verder te gaan."]);
      } else {
        setSignals(["API-key opgeslagen in deze sessie."]);
      }
      setTechLogVisible(false);
      updateButtons();
    }
  });

  btnUpload.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    selectedFile = f || null;
    outputTxt = "";
    lastTechLog = null;
    setTechLogVisible(false);
    if (!selectedFile) {
      setSignals(["Geen bestand gekozen."]);
    } else if (selectedFile.size > 10 * 1024 * 1024) {
      setSignals(["E001: Bestand te groot (>10MB). Upload een kleiner bestand."]);
      selectedFile = null;
    } else {
      setSignals([`Bestand gekozen: ${selectedFile.name}`]);
    }
    updateButtons();
  });

  btnProcess.addEventListener("click", async () => {
    if (!apiKey) {
      setSignals(["API-key is vereist om verder te gaan."]);
      return;
    }
    if (!selectedFile) {
      setSignals(["Upload eerst een persbericht."]);
      return;
    }

    showSnackbar(true);
    setSignals(["Bezig met verwerken…"]);
    setTechLogVisible(false);

    const fd = new FormData();
    fd.append("apiKey", apiKey);
    fd.append("file", selectedFile);

    try {
      const resp = await fetch("/api/process", { method: "POST", body: fd });
      const data = await resp.json();

      lastTechLog = data.techLog || null;

      if (data.status !== "ok") {
        outputTxt = "";
        setSignals(data.signalen || ["Er ging iets mis."]);
        // Bij technische fouten: toon tech log
        if (data.errorCode === "E002" || data.errorCode === "E005") {
          setTechLogVisible(true);
          downloadTechLog();
        }
      } else {
        outputTxt = data.outputTxt || "";
        setSignals(data.signalen || ["Klaar."]);
        setTechLogVisible(false);
      }
    } catch (e) {
      outputTxt = "";
      setSignals(["W010: Technisch probleem tijdens verwerking. Probeer: Ctrl+F5 en upload opnieuw."]);
      setTechLogVisible(true);
      lastTechLog = { error: String(e) };
      downloadTechLog();
    } finally {
      showSnackbar(false);
      updateButtons();
    }
  });

  function downloadTextFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function downloadTechLog() {
    if (!lastTechLog) return;
    const name = `via-persberichten-tool-log-${lastTechLog.requestId || "unknown"}.json`;
    downloadTextFile(name, JSON.stringify(lastTechLog, null, 2), "application/json");
  }

  btnDownload.addEventListener("click", () => {
    if (!outputTxt) {
      setSignals(["Nog geen output beschikbaar. Klik eerst op 'Document bewerken'."]);
      return;
    }
    const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
    downloadTextFile(`nieuwsbericht-${ts}.txt`, outputTxt, "text/plain");
  });

  // initial
  updateButtons();
})();

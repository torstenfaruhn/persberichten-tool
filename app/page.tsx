"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";

type ApiState = {
  jobId?: string;
  fileName?: string;
  fileSize?: number;
  status: "idle" | "uploaded" | "processing" | "done" | "error";
  signals: string[];
};

const INTRO_TEXT = "Dit is de persberichten-tool voor hyperlokale persberichten. Deze worden met behulp van AI herschreven, en vervolgens als concepttekst-download aangeboden. Het is de verantwoordelijkheid van de (eind)redacteur om de tekst conform de journalistieke afspraken van De Limburger te verwerken. Klik op de knoppen hieronder om een persbericht te uploaden, bewerken en het resultaat te downloaden. In het venster onderin worden meldingen getoond met betrekking tot fouten, conflicten of ontbrekende gegevens die tijdens de verwerking worden gedetecteerd.";
const FOOTER_TEXT = "\u00a9 2026 MHLI/DL. Let op: AI-gegenereerde tekst. De uitvoer van deze tool concepttekst. De inhoud is bedoeld als hulpmiddel voor redactionele bewerking. De output is geen medisch, juridisch, financieel of ander professioneel advies. De redactie blijft zelf verantwoordelijk voor fact-checking en eindredactie.";

export default function Home() {
  const [apiKey, setApiKey] = useState("");
  const [apiKeyEntered, setApiKeyEntered] = useState(false);
  const [state, setState] = useState<ApiState>({ status: "idle", signals: [] });
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const canProceed = apiKeyEntered && apiKey.trim().length > 0;
  const canUpload = canProceed && !busy;
  const canProcess = canProceed && !!state.jobId && state.status === "uploaded" && !busy;
  const canDownload = canProceed && !!state.jobId && state.status === "done" && !busy;

  const apiKeyMessage = useMemo(() => {
    if (!apiKeyEntered) return null;
    if (apiKey.trim().length === 0) return "API-key is vereist om verder te gaan.";
    return null;
  }, [apiKey, apiKeyEntered]);

  async function onUploadClick() {
    if (!canUpload) return;
    fileRef.current?.click();
  }

  async function onFileSelected(file?: File | null) {
    if (!file) return;

    setBusy(true);
    setState((s) => ({ ...s, signals: [] }));

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json();

      if (!res.ok) {
        setState({ status: "error", jobId: undefined, fileName: file.name, fileSize: file.size, signals: data?.signals ?? ["E002: Onleesbaar bestand."] });
        await maybeDownloadTechLog(data);
        return;
      }

      setState({
        status: "uploaded",
        jobId: data.jobId,
        fileName: file.name,
        fileSize: file.size,
        signals: data.signals ?? [],
      });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onProcessClick() {
    if (!canProcess || !state.jobId) return;

    setBusy(true);
    setState((s) => ({ ...s, status: "processing", signals: [] }));

    try {
      const res = await fetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: state.jobId, apiKey }),
      });

      const data = await res.json();

      if (!res.ok) {
        setState((s) => ({ ...s, status: "error", signals: data?.signals ?? ["W010: Technisch probleem tijdens verwerking."] }));
        await maybeDownloadTechLog(data);
        return;
      }

      setState((s) => ({ ...s, status: "done", signals: data.signals ?? [] }));
    } finally {
      setBusy(false);
    }
  }

  async function onDownloadClick() {
    if (!canDownload || !state.jobId) return;
    const res = await fetch(`/api/download?jobId=${encodeURIComponent(state.jobId)}`);
    if (!res.ok) return;

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "nieuwsbericht.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setState({ status: "idle", signals: [] });
  }

  function onApiKeyKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") setApiKeyEntered(true);
  }

  async function maybeDownloadTechLog(data: any) {
    const url = data?.techLogUrl;
    if (!url) return;

    const res = await fetch(url);
    if (!res.ok) return;

    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj;
    a.download = "techlog.txt";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(obj);
  }

  return (
    <main className="container">
      <div className="header">
        <Image className="logo" src="/Logo-VIA-De-Limburger.png" alt="VIA De Limburger" width={90} height={45} priority />
        <h1>VIA Persberichten-tool</h1>
        <span className="badge">{state.status === "done" ? "Klaar" : busy ? "Bezig" : "Gereed"}</span>
      </div>

      <p className="intro">{INTRO_TEXT}</p>

      <div className="field">
        <label className="label">Voer hier je API-key in en druk op Enter</label>
        <input
          className="input"
          type="password"
          inputMode="text"
          autoComplete="off"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={onApiKeyKeyDown}
          aria-describedby="apikey-help"
        />
        <div id="apikey-help" className="help">Zonder API-key kun je niet verder.</div>
        {apiKeyMessage ? <div className="help" style={{ color: "var(--danger)" }}>{apiKeyMessage}</div> : null}
      </div>

      <div className="stack">
        <button className="btn" onClick={onUploadClick} disabled={!canUpload}>
          Persbericht uploaden
          {state.fileName ? (
            <div className="meta">
              Gekozen: {state.fileName}{typeof state.fileSize === "number" ? ` (${Math.round(state.fileSize / 1024)} KB)` : ""}
            </div>
          ) : null}
        </button>

        <button className="btn" onClick={onProcessClick} disabled={!canProcess}>
          Document bewerken
        </button>

        <button className="btn" onClick={onDownloadClick} disabled={!canDownload}>
          Nieuwbericht downloaden
        </button>

        <input
          ref={fileRef}
          type="file"
          accept=".txt,.docx,.pdf"
          style={{ display: "none" }}
          onChange={(e) => onFileSelected(e.target.files?.[0])}
        />
      </div>

      <div className="panel" aria-live="polite">
        <h2>SIGNALEN</h2>
        {state.signals.length === 0 ? (
          <div className="meta">Nog geen meldingen.</div>
        ) : (
          <ul className="bullets">
            {state.signals.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
        {state.status === "error" ? (
          <div className="help" style={{ marginTop: 10 }}>
            Kopieer de technische informatie/logs en stuur deze naar de beheerder van deze site.
          </div>
        ) : null}
      </div>

      <div className="footer">{FOOTER_TEXT}</div>

      {busy ? <div className="snackbar">Bezig…</div> : null}
    </main>
  );
}

# VIA Persberichten-tool (basis)

## Start lokaal
python -m venv .venv
.venv/bin/pip install -r requirements.txt   (Windows: .venv\Scripts\pip)
python app.py

Open: http://127.0.0.1:8080

## Render
Build: pip install -r requirements.txt
Start: gunicorn app:app

## Privacy & security
- Geen logging van inhoud/persoonsdata.
- CSP actief, geen third-party scripts.


## LLM

- Zet `LLM_MODE=on` om herschrijven via API te gebruiken (standaard: on).
- Zet `LLM_MODE=off` om zonder API te draaien.
- Model: `OPENAI_MODEL` (standaard: gpt-4o-mini). Base URL: `OPENAI_BASE_URL`.

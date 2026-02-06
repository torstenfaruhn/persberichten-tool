# Via Persberichten Tool (MVP)

Webtool (FastAPI + eenvoudige, toegankelijke UI) om een persbericht te uploaden en om te zetten naar een nieuwsbericht met **SIGNALEN**.

## Lokaal draaien

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

pip install -r requirements.txt
uvicorn app.main:app --reload
```

Open daarna: `http://127.0.0.1:8000`

## Deploy naar Render (Blueprint)

Deze repo bevat een `render.yaml`. Op Render:

1. Push deze repo naar GitHub.
2. Render → **New** → **Blueprint** → selecteer je repo.
3. Render maakt een Python Web Service met:
   - build: `pip install -r requirements.txt`
   - start: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - health check: `/health`

### Environment variables

De UI vraagt om een API-key. De backend gebruikt die om een OpenAI-compatibele chat-completions call te doen.

Optioneel (default staat in `render.yaml`):
- `OPENAI_BASE_URL` (default: `https://api.openai.com`)

> Gebruik je een andere provider? Zorg dat het endpoint OpenAI-compatibel is of pas `app/llm.py` aan.

## Repo-structuur

- `app/` – FastAPI backend (extractie, validatie, herschrijven, SIGNALEN)
- `static/` – UI (HTML/CSS/JS)
- `stylebooks_*` – meegeleverde stijlboeken die als guidance worden geladen

## Security & privacy

- Uploads worden tijdelijk verwerkt in een tijdelijke directory en daarna verwijderd.
- Geen opslag van inhoud/persoonsgegevens in logs (alleen foutcodes/technische status).

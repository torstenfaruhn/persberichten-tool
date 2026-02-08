# VIA Persberichten-tool (Optie A)

Online UI + server die persberichten omzet naar conceptnieuws + SIGNALEN.

## Wat dit is
- 1 Node/Express app die een statische UI serveert (`/public`) en een API-endpoint (`/api/process`) aanbiedt.
- Geen database, geen persistente opslag.
- Geen logging van artikeltekst of persoonsdata. Alleen technische logs met status/foutcode.

## Werking (gebruiker)
1. API-key invoeren en op Enter drukken.
2. Persbericht uploaden (.txt/.docx/.pdf, max 10 MB).
3. Klik op “Document bewerken”.
4. Lees SIGNALEN.
5. Klik op “Nieuwbericht downloaden”.

## Installeren (lokaal)
```bash
npm install
npm start
```
Open daarna: http://localhost:3000

## Render
- Start command: `npm start`
- Node versie: 20+ aanbevolen
- Zet eventueel env vars:
  - `LLM_BASE_URL` (default `https://api.openai.com/v1`) – OpenAI-compatibele endpoint
  - `LLM_MODEL` (default `gpt-4o-mini`)

## Security
- CSP via Helmet, geen third-party scripts.
- `Cache-Control: no-store`.
- Uploads worden in memory verwerkt en niet bewaard.

## Opmerkingen
- Detectie van meerdere persberichten is heuristisch (scoremodel).
- Extern verifiëren (W008) wordt gezet als er cijfers/datum-achtige patronen voorkomen.

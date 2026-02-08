# VIA Persberichten-tool (monolith)

Online tool om persberichten (.txt/.docx/.pdf) te uploaden, via OpenAI te herschrijven naar een conceptnieuwsbericht, en als .txt te downloaden. De tool toont SIGNALEN (fouten/waarschuwingen) volgens de prompt.

## Privacy en veiligheid
- Geen opslag van uploads of output buiten tijdelijke bestanden in `/tmp` (gewist na download of na verloop).
- Geen logging van tekstinhoud of persoonsgegevens. Alleen technische logs (foutcode + korte omschrijving) en alleen als download bij een fout.
- Geen analytics, tracking of third-party scripts.
- CSP-header staat aan via `middleware.ts`.

## Lokale start
1. `npm install`
2. `npm run dev`
3. Open `http://localhost:3000`

## Deploy op Render
- Build command: `npm install && npm run build`
- Start command: `npm run start`
- Environment variables: geen nodig. (API-key wordt door gebruiker ingevoerd en niet opgeslagen.)

## Stijlboek-bijlagen (ongewijzigd)
De volgende bestanden staan in `stylebooks/` en mogen alleen 1-op-1 vervangen worden bij updates (niet hernoemen, niet aanpassen):
- DL-Stijlboek-Afspraken.pdf
- DL-Stijlboek-Veelgemaakte-fouten.pdf
- Stijlboek en typografie De Limburger.docx

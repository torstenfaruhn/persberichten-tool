export function normalizeForWordCount(input: string): string {
  // Word-telling: karakters inclusief spaties, zonder regeleinden en normaliseer dubbele spaties.
  return input
    .replace(/\r\n/g, "\n")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s\s+/g, " ")
    .trim();
}

export function wordCountChars(input: string): number {
  return normalizeForWordCount(input).length;
}

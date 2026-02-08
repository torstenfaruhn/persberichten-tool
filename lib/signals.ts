export type SignalLevel = "error" | "warning" | "info";

export type Signal = {
  code: string;
  message: string; // B1
  level: SignalLevel;
};

export function fmtSignal(s: Signal): string {
  const prefix = s.code ? `${s.code}: ` : "";
  return `${prefix}${s.message}`;
}

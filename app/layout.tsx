import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "VIA Persberichten-tool",
  description: "Persberichten herschrijven naar conceptnieuwsbericht met SIGNALEN.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}

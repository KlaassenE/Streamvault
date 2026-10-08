import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "Streamvault", template: "%s | Streamvault" },
  description:
    "Your own video library. Familiar interests, new discoveries, and a place to pick up where you left off.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{const t=localStorage.getItem('streamvault-theme');document.documentElement.dataset.theme=t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'}catch{}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}

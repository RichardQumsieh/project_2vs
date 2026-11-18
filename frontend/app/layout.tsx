import type { Metadata } from "next";
import { headers } from "next/headers";
import { SiteHeader } from "@/components/site-header";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sophia | Chief of staff",
  description:
    "Sophia is the chief of staff in an end-to-end encrypted messenger.",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const nonce = (await headers()).get("x-nonce");
  if (!nonce) {
    throw new Error("The request security nonce is missing.");
  }

  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html:
              'try{var t=localStorage.getItem("private-app-theme");document.documentElement.dataset.theme=t==="light"||t==="dark"||t==="system"?t:"system"}catch{document.documentElement.dataset.theme="system"}',
          }}
        />
      </head>
      <body>
        <div className="ambient-background" aria-hidden="true">
          <span className="ambient-orb ambient-orb-one" />
          <span className="ambient-orb ambient-orb-two" />
          <span className="ambient-orb ambient-orb-three" />
          <span className="ambient-orb ambient-orb-four" />
        </div>
        <Providers>
          <SiteHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}

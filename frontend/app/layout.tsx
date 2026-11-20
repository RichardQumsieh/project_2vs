import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { SiteHeader } from "@/components/site-header";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sophia | Chief of staff",
  description:
    "Sophia is the chief of staff in an end-to-end encrypted messenger.",
  applicationName: "Sophia",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Sophia",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#080d16",
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
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html:
              'try{var q=new URLSearchParams(location.search).get("lang");var l=q==="ar"||q==="en"?q:localStorage.getItem("sophia-locale");if(l==="ar"||l==="en"){localStorage.setItem("sophia-locale",l);document.documentElement.lang=l;document.documentElement.dir=l==="ar"?"rtl":"ltr"}}catch(e){}',
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

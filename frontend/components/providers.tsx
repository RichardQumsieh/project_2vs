"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useState } from "react";
import { PwaRegister } from "@/components/pwa-register";
import { ThemeProvider } from "@/components/theme-provider";
import { LocaleProvider } from "@/lib/i18n/locale";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: 1 },
        },
      }),
  );

  return (
    <MotionConfig reducedMotion="user">
      <LocaleProvider>
        <ThemeProvider>
          <QueryClientProvider client={client}>
            <PwaRegister />
            <div className="app-content">{children}</div>
          </QueryClientProvider>
        </ThemeProvider>
      </LocaleProvider>
    </MotionConfig>
  );
}

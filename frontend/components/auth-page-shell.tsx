"use client";

import { motion, useReducedMotion } from "motion/react";

export function AuthPageShell({
  eyebrow,
  title,
  description,
  footer,
  children,
}: {
  eyebrow: string;
  title: string;
  description: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <main className="auth-page relative flex min-h-[100svh] items-center justify-center overflow-x-clip px-4 py-10 sm:px-6 sm:py-16">
      <motion.div
        aria-hidden="true"
        className="auth-page-glow auth-page-glow-one"
        initial={reduceMotion ? false : { opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: reduceMotion ? 0 : 1.1, ease: "easeOut" }}
      />
      <motion.div
        aria-hidden="true"
        className="auth-page-glow auth-page-glow-two"
        initial={reduceMotion ? false : { opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: reduceMotion ? 0 : 1.2, delay: reduceMotion ? 0 : 0.12, ease: "easeOut" }}
      />
      <motion.section
        initial={reduceMotion ? false : { opacity: 0, y: 22, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.52, ease: [0.22, 1, 0.36, 1] }}
        className="auth-card relative z-10 w-full max-w-md overflow-hidden rounded-[2rem] border border-white/10 bg-[#0c111b]/80 p-5 shadow-[0_32px_120px_rgba(0,0,0,.42)] backdrop-blur-2xl sm:p-8"
      >
        <div className="mb-7 flex items-center gap-3">
          <div className="auth-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-wide text-white">Private</p>
            <p className="text-[0.65rem] tracking-[0.16em] text-white/35 uppercase">
              made for your conversations
            </p>
          </div>
        </div>
        <p className="text-xs tracking-[0.2em] text-(--accent) uppercase">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-[2.1rem]">
          {title}
        </h1>
        <p className="mt-3 mb-7 text-sm leading-6 text-white/50">{description}</p>
        {children}
        <div className="mt-6 border-t border-white/[0.07] pt-5 text-center text-sm text-white/45">
          {footer}
        </div>
      </motion.section>
    </main>
  );
}

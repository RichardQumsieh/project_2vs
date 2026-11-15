"use client";
import Link from "next/link";
import { motion } from "motion/react";
import { FloatingBubbles } from "./floating-bubbles";

export function Homepage() {
  return (
    <main className="overflow-hidden">
      <section className="relative flex min-h-[100svh] items-center justify-center border-b border-white/10 px-4 pt-24 pb-16 sm:px-6 sm:py-20">
        <FloatingBubbles />

        <div className="relative z-10 mx-auto w-full max-w-5xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-4 py-2 text-xs tracking-[0.18em] text-white/55 uppercase"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-(--accent)" />
            Private communication
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1 }}
            className="text-balance text-[clamp(2.4rem,9vw,5rem)] font-semibold leading-[1.03] tracking-[-0.045em] text-white sm:text-7xl lg:text-8xl"
          >
            Conversations
            <br />
            that stay yours.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mx-auto mt-6 max-w-2xl text-base leading-7 text-white/55 sm:mt-7 sm:text-xl sm:leading-8"
          >
            A private messaging platform built around end-to-end encrypted
            conversations, thoughtful design, and control that stays with you.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Link
              href="/signup"
              className="w-full rounded-full bg-white px-5 py-3.5 text-sm font-medium text-black transition-transform hover:scale-[1.02] sm:w-auto sm:px-7"
            >
              Start a private conversation
            </Link>
            <Link
              href="#security"
              className="w-full rounded-full border border-white/10 bg-white/[0.035] px-5 py-3.5 text-sm font-medium text-white/75 backdrop-blur transition hover:bg-white/[0.07] sm:w-auto sm:px-7"
            >
              See how it works
            </Link>
          </motion.div>
        </div>

        <motion.div
          className="absolute bottom-4 left-1/2 hidden -translate-x-1/2 text-xs text-white/30 sm:block"
          animate={{ y: [0, 7, 0], opacity: [0.35, 0.7, 0.35] }}
          transition={{ duration: 2.2, repeat: Infinity }}
        >
          Scroll to explore
        </motion.div>
      </section>

      <section id="security" className="relative border-b border-white/10 px-4 py-20 sm:px-6 sm:py-32">
        <div className="mx-auto max-w-6xl">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.7 }}
            className="max-w-2xl"
          >
            <p className="text-sm tracking-[0.18em] text-(--accent) uppercase">
              Security first
            </p>
            <h2             className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-6xl">
              Your message should belong to the people in the conversation.
            </h2>
            <p className="mt-6 text-lg leading-8 text-white/50">
              The product will be designed so the server transports encrypted
              message data without becoming the place where conversations are
              readable.
            </p>
          </motion.div>

          <div className="mt-12 grid gap-3 sm:mt-20 sm:gap-4 md:grid-cols-3">
            {[
              ["01", "Private by architecture", "Encryption is part of the system design, not a feature added at the end."],
              ["02", "Fast by default", "Optimistic interfaces, real-time delivery, careful caching, and lightweight interactions."],
              ["03", "Built to grow", "The foundation leaves room for multiple devices, groups, media, and more."],
            ].map(([number, title, description], index) => (
              <motion.article
                key={number}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.2 }}
                transition={{ duration: 0.6, delay: index * 0.08 }}
                className="rounded-3xl border border-white/10 bg-white/2.5 p-5 sm:p-7"
              >
                <span className="text-xs text-(--accent)">{number}</span>
                <h3 className="mt-7 text-xl font-medium sm:mt-12">{title}</h3>
                <p className="mt-3 leading-7 text-white/45">{description}</p>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-4 py-20 sm:px-6 sm:py-32">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, amount: 0.25 }}
          transition={{ duration: 0.7 }}
          className="mx-auto max-w-5xl rounded-4xl border border-white/10 bg-white/2.5 px-5 py-12 text-center sm:px-12 sm:py-20"
        >
          <p className="text-sm tracking-[0.18em] text-white/35 uppercase">
            The beginning
          </p>
          <h2 className="mt-5 text-3xl font-semibold tracking-[-0.03em] sm:text-6xl">
            Built for one conversation at a time.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-8 text-white/50">
            We start with direct conversations. Then we earn the right to add
            everything else.
          </p>
          <Link
            href="/signup"
            className="mt-9 inline-flex rounded-full bg-white px-7 py-3.5 text-sm font-medium text-black"
          >
            Create your account
          </Link>
        </motion.div>
      </section>
    </main>
  );
}

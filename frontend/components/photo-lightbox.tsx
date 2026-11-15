"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";

export function PhotoLightbox({
  open,
  src,
  alt,
  onClose,
}: {
  open: boolean;
  src: string | null;
  alt: string;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && src ? (
        <motion.div
          key="photo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          className="fixed inset-0 z-[160] flex items-center justify-center bg-black/88 p-3 backdrop-blur-md sm:p-8"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <button
            type="button"
            className="absolute top-[max(1rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] rounded-full border border-white/15 bg-black/50 p-2 text-white/80 hover:bg-black/70"
            aria-label="Close photo"
            onClick={onClose}
          >
            <X className="size-5" aria-hidden="true" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <motion.img
            src={src}
            alt={alt}
            className="max-h-[min(92dvh,56rem)] max-w-full rounded-2xl object-contain shadow-2xl"
            initial={reduceMotion ? false : { scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            onClick={(event) => event.stopPropagation()}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

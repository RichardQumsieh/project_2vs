import { motion } from "motion/react";

const bubbles = [
  { text: "Are you free tonight?", className: "left-[4%] top-[20%]", delay: 0 },
  { text: "Absolutely.", className: "right-[5%] top-[30%]", delay: 0.5 },
  { text: "I'll send you the details.", className: "left-[10%] bottom-[16%]", delay: 1 },
  { text: "Private by design.", className: "right-[9%] bottom-[12%]", delay: 1.5 },
];

export function FloatingBubbles() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {bubbles.map((bubble) => (
        <motion.div
          key={bubble.text}
          className={`absolute hidden rounded-full border border-white/10 bg-white/4.5 px-5 py-3 text-sm text-white/70 shadow-2xl backdrop-blur-md md:block ${bubble.className}`}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: [0, -10, 0] }}
          transition={{
            opacity: { duration: 0.8, delay: bubble.delay },
            y: { duration: 5, repeat: Infinity, ease: "easeInOut", delay: bubble.delay },
          }}
        >
          {bubble.text}
        </motion.div>
      ))}
    </div>
  );
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { ProductShell } from "@/components/product-shell";
import { SophiaRobotPreview } from "@/components/sophia-robot-preview";
import { useI18n } from "@/lib/i18n/locale";

const prompts = [
  {
    title: "Desk companion",
    prompt:
      "Compact brushed-steel assistant robot on a dark messaging desk, amber eye core, teal rim light, cinematic product still, no text",
  },
  {
    title: "Speaking viseme",
    prompt:
      "Close-up of a humanoid robot jaw articulating mid-sentence, soft graphite armor, gold accent diodes, shallow depth of field",
  },
  {
    title: "Presence orb",
    prompt:
      "Abstract robot presence icon: circular metallic iris with teal and amber rings, minimal, app avatar ready, dark charcoal field",
  },
  {
    title: "Mobile HUD",
    prompt:
      "Smartphone chat UI with a floating robot bust in the corner speaking, responsive layout, premium dark UI, no logos",
  },
];

export default function SophiaStudioPage() {
  const { t } = useI18n();
  return (
    <ProductShell
      title={t("studio.title")}
      subtitle={t("studio.subtitle")}
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_18rem]">
        <section className="space-y-5">
          <div className="overflow-hidden rounded-3xl border border-white/10 bg-[#0b1018]">
            <div className="relative aspect-[16/9] w-full">
              <Image
                src="/sophia/robot-portrait.jpg"
                alt="Sophia robot portrait"
                fill
                className="object-cover object-[center_20%]"
                sizes="(max-width: 1024px) 100vw, 42rem"
                priority
              />
            </div>
            <div className="space-y-2 p-5 sm:p-6">
              <h2 className="text-lg font-medium text-white">Talking robot body</h2>
              <p className="text-sm leading-relaxed text-white/55">
                In chat, Sophia appears as a responsive robot presence that switches between idle,
                listening, thinking, and speaking while local speech synthesis runs. Open a
                conversation, enable the assistant, and use Active voice or Speak to hear it.
              </p>
              <Link href="/inbox?hub=assistant" title="Open the Sophia assistant" aria-label="Open the Sophia assistant" className="inline-flex text-sm text-cyan-200/80 underline-offset-2 hover:underline">
                Open the Sophia assistant
              </Link>
            </div>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
            <h2 className="text-lg font-medium text-white">Presentation workflow</h2>
            <p className="mt-2 text-sm leading-relaxed text-white/55">
              Ask Sophia to prepare a presentation and approve the staged action. Sophia builds a
              multi-slide <strong className="font-medium text-white">.pptx</strong> locally with a
              technology-forward narrative for the subject — not a Markdown stub.
            </p>
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 sm:p-6">
            <h2 className="text-lg font-medium text-white">Image creation prompts</h2>
            <p className="mt-2 text-sm text-white/55">
              Use these when generating alternate skins, store assets, or marketing stills.
            </p>
            <ul className="mt-4 space-y-3">
              {prompts.map((item) => (
                <li
                  key={item.title}
                  className="rounded-2xl border border-white/8 bg-black/20 p-3"
                >
                  <p className="text-xs tracking-wide text-amber-100/70 uppercase">
                    {item.title}
                  </p>
                  <p className="mt-1 text-sm text-white/75">{item.prompt}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <SophiaRobotPreview />
      </div>
    </ProductShell>
  );
}

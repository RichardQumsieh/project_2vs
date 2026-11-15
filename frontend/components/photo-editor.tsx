"use client";

import { useEffect, useRef, useState } from "react";
import { maxPhotoBytes } from "@/lib/crypto/media";
import { getPhotoEditorDimensions } from "@/lib/photo-editor-utils";

const filters = [
  { id: "original", label: "Original", css: "none" },
  { id: "warm", label: "Warm", css: "sepia(.32) saturate(1.22)" },
  { id: "mono", label: "Mono", css: "grayscale(1) contrast(1.08)" },
  { id: "soft", label: "Soft blur", css: "blur(2px) saturate(1.08)" },
] as const;

const emojis = ["✨", "❤️", "🌸", "☀️", "😍", "🔥", "💫", "🌈"];

function addCaption(context: CanvasRenderingContext2D, caption: string) {
  const lines = caption.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return;

  const fontSize = Math.max(22, Math.min(72, context.canvas.width * 0.055));
  const lineHeight = fontSize * 1.25;
  const bottomPadding = fontSize * 1.2;
  context.save();
  context.font = `700 ${fontSize}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  lines.forEach((line, index) => {
    const y = context.canvas.height - bottomPadding - (lines.length - 1 - index) * lineHeight;
    const maxWidth = context.canvas.width * 0.9;
    context.lineWidth = fontSize * 0.18;
    context.strokeStyle = "rgba(0, 0, 0, .78)";
    context.fillStyle = "#fff";
    context.strokeText(line, context.canvas.width / 2, y, maxWidth);
    context.fillText(line, context.canvas.width / 2, y, maxWidth);
  });
  context.restore();
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob
        ? resolve(blob)
        : reject(new Error("Could not export the edited photo.")),
      type,
      quality,
    );
  });
}

export function PhotoEditor({
  file,
  onSave,
  onCancel,
}: {
  file: File;
  onSave: (file: File) => void;
  onCancel: () => void;
}) {
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const paintCanvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const drawingRef = useRef(false);
  const [filterId, setFilterId] = useState<(typeof filters)[number]["id"]>("original");
  const [brushColor, setBrushColor] = useState("#ff5d9e");
  const [brushSize, setBrushSize] = useState(10);
  const [caption, setCaption] = useState("");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void createImageBitmap(file).then((bitmap) => {
      if (!active) {
        bitmap.close();
        return;
      }
      bitmapRef.current = bitmap;
      const { width, height } = getPhotoEditorDimensions(bitmap.width, bitmap.height);
      for (const canvas of [imageCanvasRef.current, paintCanvasRef.current]) {
        if (canvas) {
          canvas.width = width;
          canvas.height = height;
        }
      }
      const context = imageCanvasRef.current?.getContext("2d");
      if (!context) {
        setError("Could not prepare the photo editor.");
        return;
      }
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, width, height);
      setReady(true);
    }).catch(() => {
      if (active) setError("This photo format cannot be opened for editing.");
    });

    return () => {
      active = false;
      bitmapRef.current?.close();
      bitmapRef.current = null;
    };
  }, [file]);

  useEffect(() => {
    const bitmap = bitmapRef.current;
    const canvas = imageCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!bitmap || !canvas || !context || !ready) return;

    const filter = filters.find((item) => item.id === filterId);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.filter = filter?.css ?? "none";
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    context.filter = "none";
  }, [filterId, ready]);

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = paintCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * (canvas.width / bounds.width);
    const y = (event.clientY - bounds.top) * (canvas.height / bounds.height);

    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = brushColor;
    context.lineWidth = brushSize * (canvas.width / bounds.width);
    if (!drawingRef.current) {
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + 0.01, y + 0.01);
      context.stroke();
    } else {
      context.lineTo(x, y);
      context.stroke();
    }
  }

  async function saveEditedPhoto() {
    const base = imageCanvasRef.current;
    const paint = paintCanvasRef.current;
    if (!base || !paint || !ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const output = document.createElement("canvas");
      output.width = base.width;
      output.height = base.height;
      const context = output.getContext("2d");
      if (!context) throw new Error("Could not export the edited photo.");
      context.drawImage(base, 0, 0);
      context.drawImage(paint, 0, 0);
      addCaption(context, caption);

      let blob: Blob | null = null;
      for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5]) {
        blob = await canvasBlob(output, "image/webp", quality);
        if (blob.type !== "image/webp" || blob.size <= maxPhotoBytes) break;
      }
      if (!blob || blob.size > maxPhotoBytes) {
        throw new Error("The edited photo is still over 6 MB. Reduce its size and try again.");
      }
      const extension = blob.type.split("/")[1] || "webp";
      const name = file.name.replace(/\.[^.]+$/, "") || "photo";
      onSave(new File([blob], `${name}-edited.${extension}`, { type: blob.type }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this edit.");
      setSaving(false);
    }
  }

  function drawStart(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready || saving) return;
    drawingRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    draw(event);
  }

  function drawEnd(event: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 p-2 backdrop-blur-md sm:p-5"
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-editor-title"
        className="flex max-h-[100dvh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/15 bg-slate-950/95 text-white shadow-2xl sm:max-h-[94dvh]"
      >
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <h2 id="photo-editor-title" className="text-sm font-semibold sm:text-base">
              Make it yours
            </h2>
            <p className="mt-1 text-[11px] text-white/50">
              Edits stay on this device until you send the encrypted photo.
            </p>
          </div>
          <button
            type="button"
            className="rounded-full px-3 py-2 text-xs text-white/60 hover:bg-white/10 hover:text-white"
            disabled={saving}
            onClick={onCancel}
          >
            Cancel
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          <div className="mx-auto flex min-h-32 max-h-[48dvh] w-full items-center justify-center overflow-hidden rounded-2xl bg-black/50 sm:max-h-[52dvh]">
            <div className="relative inline-grid max-h-full max-w-full place-items-center">
              <canvas
                ref={imageCanvasRef}
                aria-label="Photo preview"
                className="block max-h-[48dvh] max-w-full object-contain sm:max-h-[52dvh]"
              />
              <canvas
                ref={paintCanvasRef}
                aria-label="Draw on photo"
                className="absolute inset-0 h-full w-full touch-none"
                onPointerDown={drawStart}
                onPointerMove={(event) => {
                  if (drawingRef.current) draw(event);
                }}
                onPointerUp={drawEnd}
                onPointerCancel={drawEnd}
              />
              {caption.trim() ? (
                <p className="pointer-events-none absolute inset-x-2 bottom-3 text-center text-wrap text-base font-bold whitespace-pre-wrap text-white [text-shadow:0_2px_5px_#000,1px_1px_2px_#000] sm:bottom-5 sm:text-2xl">
                  {caption}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-4 space-y-4">
            <fieldset>
              <legend className="mb-2 text-[11px] font-medium text-white/65">Looks</legend>
              <div className="flex flex-wrap gap-2">
                {filters.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    aria-pressed={filterId === filter.id}
                    className={`rounded-full border px-3 py-2 text-xs transition ${
                      filterId === filter.id
                        ? "border-indigo-300/70 bg-indigo-300/15 text-white"
                        : "border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
                    }`}
                    onClick={() => setFilterId(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="photo-overlay-text" className="mb-2 block text-[11px] font-medium text-white/65">
                  Text and emojis
                </label>
                <textarea
                  id="photo-overlay-text"
                  value={caption}
                  maxLength={140}
                  rows={2}
                  placeholder="Add a little moment…"
                  className="w-full resize-y rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-indigo-300/60"
                  onChange={(event) => setCaption(event.currentTarget.value)}
                />
                <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Add an emoji">
                  {emojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      aria-label={`Add ${emoji}`}
                      className="grid size-8 place-items-center rounded-lg bg-white/[0.06] text-lg hover:bg-white/15"
                      onClick={() => setCaption((value) => `${value}${emoji}`.slice(0, 140))}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              <fieldset>
                <legend className="mb-2 text-[11px] font-medium text-white/65">Paint</legend>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-white/60">
                    <span>Color</span>
                    <input
                      type="color"
                      value={brushColor}
                      aria-label="Paint color"
                      className="size-9 cursor-pointer rounded-lg border border-white/15 bg-transparent p-1"
                      onChange={(event) => setBrushColor(event.currentTarget.value)}
                    />
                  </label>
                  <label className="min-w-0 flex-1 text-xs text-white/60">
                    Brush size
                    <input
                      type="range"
                      min="3"
                      max="28"
                      value={brushSize}
                      className="mt-2 block w-full accent-indigo-300"
                      onChange={(event) => setBrushSize(Number(event.currentTarget.value))}
                    />
                  </label>
                  <button
                    type="button"
                    className="self-end rounded-full border border-white/10 px-3 py-2 text-xs text-white/60 hover:bg-white/10"
                    onClick={() => {
                      const canvas = paintCanvasRef.current;
                      const context = canvas?.getContext("2d");
                      if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
                    }}
                  >
                    Clear
                  </button>
                </div>
                <p className="mt-2 text-[10px] text-white/40">
                  Draw directly on the photo with touch, mouse, or pen.
                </p>
              </fieldset>
            </div>
          </div>
          {error ? <p role="alert" className="mt-3 text-xs text-red-300">{error}</p> : null}
        </div>

        <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-white/10 px-4 py-3 sm:px-6">
          <button
            type="button"
            disabled={saving}
            className="mr-auto rounded-full px-3 py-2 text-xs text-white/55 hover:bg-white/10 hover:text-white"
            onClick={() => onSave(file)}
          >
            Use original
          </button>
          <button
            type="button"
            disabled={!ready || saving}
            className="rounded-full bg-indigo-200 px-5 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-indigo-100 disabled:opacity-50"
            onClick={() => void saveEditedPhoto()}
          >
            {saving ? "Preparing…" : "Apply edits"}
          </button>
        </footer>
      </section>
    </div>
  );
}

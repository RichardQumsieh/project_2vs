export function voiceCancelArmed(translationX: number, rtl: boolean, threshold = 72) {
  return rtl ? translationX > threshold : translationX < -threshold;
}

export function meteringToLevel(db: number | null | undefined) {
  if (db == null || !Number.isFinite(db)) return 0.2;
  const clamped = Math.min(0, Math.max(-50, db));
  return (clamped + 50) / 50;
}

export function compactWave(levels: readonly number[], buckets = 32) {
  const usable = levels.filter((level) => Number.isFinite(level));
  if (!usable.length) return [];
  const size = Math.max(1, Math.ceil(usable.length / buckets));
  const wave: number[] = [];
  for (let index = 0; index < usable.length && wave.length < buckets; index += size) {
    const slice = usable.slice(index, index + size);
    const average = slice.reduce((sum, value) => sum + value, 0) / slice.length;
    wave.push(Math.min(1, Math.max(0, average)));
  }
  return wave;
}

export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const remain = total % 60;
  return `${minutes}:${String(remain).padStart(2, "0")}`;
}

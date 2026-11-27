export type CropAspect = "original" | "square" | "fourFive" | "wide";

const aspects: Record<Exclude<CropAspect, "original">, number> = {
  square: 1,
  fourFive: 4 / 5,
  wide: 16 / 9,
};

export function rotatedSize(width: number, height: number, rotation: number) {
  const turns = ((rotation % 360) + 360) % 360;
  if (turns === 90 || turns === 270) return { width: height, height: width };
  return { width, height };
}

export function centeredCrop(width: number, height: number, aspect: CropAspect) {
  if (aspect === "original" || width <= 0 || height <= 0) return null;
  const target = aspects[aspect];
  const current = width / height;
  if (Math.abs(current - target) < 0.02) return null;
  if (current > target) {
    const cropWidth = Math.max(1, Math.round(height * target));
    return {
      originX: Math.max(0, Math.round((width - cropWidth) / 2)),
      originY: 0,
      width: Math.min(width, cropWidth),
      height,
    };
  }
  const cropHeight = Math.max(1, Math.round(width / target));
  return {
    originX: 0,
    originY: Math.max(0, Math.round((height - cropHeight) / 2)),
    width,
    height: Math.min(height, cropHeight),
  };
}

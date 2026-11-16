const maxCanvasDimension = 2048;

export function getPhotoEditorDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error("The photo has invalid dimensions.");
  }
  const scale = Math.min(1, maxCanvasDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

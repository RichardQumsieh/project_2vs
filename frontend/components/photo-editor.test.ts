import { describe, expect, it } from "vitest";
import { getPhotoEditorDimensions } from "../lib/photo-editor-utils";

describe("photo editor dimensions", () => {
  it("limits large images while preserving their aspect ratio", () => {
    expect(getPhotoEditorDimensions(6000, 4000)).toEqual({
      width: 2048,
      height: 1365,
    });
    expect(getPhotoEditorDimensions(4000, 6000)).toEqual({
      width: 1365,
      height: 2048,
    });
  });

  it("keeps smaller images at their original dimensions", () => {
    expect(getPhotoEditorDimensions(720, 1280)).toEqual({
      width: 720,
      height: 1280,
    });
  });

  it("rejects invalid photo dimensions", () => {
    expect(() => getPhotoEditorDimensions(0, 100)).toThrow(
      "The photo has invalid dimensions.",
    );
    expect(() => getPhotoEditorDimensions(Number.NaN, 100)).toThrow(
      "The photo has invalid dimensions.",
    );
  });
});

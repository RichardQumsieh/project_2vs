import { describe, expect, it } from "vitest";
import { centeredCrop, rotatedSize } from "./photo-edit-math";

describe("photo editor geometry", () => {
  it("rotates dimensions and crops to the requested aspect from the center", () => {
    expect(rotatedSize(400, 200, 90)).toEqual({ width: 200, height: 400 });
    expect(rotatedSize(400, 200, 180)).toEqual({ width: 400, height: 200 });
    const square = centeredCrop(400, 200, "square");
    expect(square).toEqual({ originX: 100, originY: 0, width: 200, height: 200 });
    expect(centeredCrop(200, 200, "square")).toBeNull();
    expect(centeredCrop(400, 200, "original")).toBeNull();
  });
});

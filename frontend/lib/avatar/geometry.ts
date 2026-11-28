import type { AvatarConfig } from "./config";
import { transformPoint, type Vec3 } from "./mat4";
import { groupMatrix, idlePose, type AvatarGroup, type Pose, type Pivots } from "./pose";

export type DrawMesh = {
  group: AvatarGroup;
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint16Array;
};

export type AvatarModel = {
  meshes: DrawMesh[];
  pivots: Pivots;
  stats: { triangles: number; vertices: number; drawCalls: number };
};

type Bucket = { positions: number[]; colors: number[]; indices: number[] };

function bucket(): Bucket {
  return { positions: [], colors: [], indices: [] };
}

function addBox(
  positions: number[],
  indices: number[],
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  rotZ = 0,
) {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const raw = [
    -hx, -hy, hz, hx, -hy, hz, hx, hy, hz, -hx, hy, hz,
    hx, -hy, -hz, -hx, -hy, -hz, -hx, hy, -hz, hx, hy, -hz,
    -hx, -hy, -hz, -hx, -hy, hz, -hx, hy, hz, -hx, hy, -hz,
    hx, -hy, hz, hx, -hy, -hz, hx, hy, -hz, hx, hy, hz,
    -hx, hy, hz, hx, hy, hz, hx, hy, -hz, -hx, hy, -hz,
    -hx, -hy, -hz, hx, -hy, -hz, hx, -hy, hz, -hx, -hy, hz,
  ];
  const c = Math.cos(rotZ);
  const s = Math.sin(rotZ);
  const base = positions.length / 3;
  for (let index = 0; index < raw.length; index += 3) {
    const x = raw[index]!;
    const y = raw[index + 1]!;
    const z = raw[index + 2]!;
    positions.push(cx + x * c - y * s, cy + x * s + y * c, cz + z);
  }
  const faces = [
    0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11,
    12, 13, 14, 12, 14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
  ];
  for (const face of faces) indices.push(base + face);
}

function addEllipsoid(
  positions: number[],
  indices: number[],
  cx: number,
  cy: number,
  cz: number,
  rx: number,
  ry: number,
  rz: number,
  segments = 8,
  rings = 5,
) {
  const base = positions.length / 3;
  const stride = segments + 1;
  for (let y = 0; y <= rings; y += 1) {
    const phi = (y / rings) * Math.PI;
    const sy = Math.cos(phi);
    const sr = Math.sin(phi);
    for (let x = 0; x <= segments; x += 1) {
      const theta = (x / segments) * Math.PI * 2;
      positions.push(cx + Math.cos(theta) * sr * rx, cy + sy * ry, cz + Math.sin(theta) * sr * rz);
    }
  }
  for (let y = 0; y < rings; y += 1) {
    for (let x = 0; x < segments; x += 1) {
      const a = base + y * stride + x;
      const b = a + stride;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
}

function hexToRgb(hex: string): Vec3 {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function shade(color: Vec3, factor: number): Vec3 {
  return [color[0] * factor, color[1] * factor, color[2] * factor];
}

function paint(target: Bucket, color: Vec3, draw: (positions: number[], indices: number[]) => void) {
  const positions: number[] = [];
  const indices: number[] = [];
  draw(positions, indices);
  const offset = target.positions.length / 3;
  for (const value of positions) target.positions.push(value);
  for (let index = 0; index < positions.length; index += 3) {
    target.colors.push(color[0], color[1], color[2]);
  }
  for (const index of indices) target.indices.push(index + offset);
}

export function buildAvatar(config: AvatarConfig): AvatarModel {
  const body = bucket();
  const head = bucket();
  const armL = bucket();
  const armR = bucket();
  const skin = hexToRgb(config.skin);
  const hair = hexToRgb(config.hairColor);
  const iris = hexToRgb(config.eyeColor);
  const top = hexToRgb(config.top);
  const accent = hexToRgb(config.accent);
  const torsoW = config.body === "slim" ? 0.32 : config.body === "broad" ? 0.5 : 0.4;
  const shoulderX = torsoW / 2 + 0.04;
  const headSpec = config.head === "oval"
    ? { kind: "sphere" as const, rx: 0.16, ry: 0.22, rz: 0.17 }
    : config.head === "square"
      ? { kind: "box" as const, rx: 0.18, ry: 0.2, rz: 0.16 }
      : { kind: "sphere" as const, rx: 0.19, ry: 0.19, rz: 0.19 };
  const frontZ = headSpec.kind === "box" ? headSpec.rz : headSpec.rz * 0.86;
  const pivots: Pivots = {
    head: [0, 1.58, 0],
    armL: [-shoulderX, 1.3, 0],
    armR: [shoulderX, 1.3, 0],
  };
  const dress = config.outfit === "dress";
  const torsoH = dress ? 0.72 : 0.48;
  const torsoY = dress ? 0.98 : 1.08;

  paint(body, top, (positions, indices) => addBox(positions, indices, 0, torsoY, 0, torsoW, torsoH, 0.24));
  paint(body, shade(top, 0.82), (positions, indices) => addBox(positions, indices, 0, torsoY + torsoH * 0.08, 0.13, torsoW * 0.55, 0.08, 0.02));
  if (config.outfit === "hoodie") {
    paint(body, accent, (positions, indices) => addBox(positions, indices, 0, torsoY - 0.05, 0.13, torsoW * 0.46, 0.12, 0.03));
  }
  if (config.outfit === "collar") {
    paint(body, accent, (positions, indices) => addBox(positions, indices, 0, torsoY + torsoH / 2 + 0.02, 0.04, torsoW * 0.46, 0.06, 0.16));
  }
  if (dress) {
    paint(body, accent, (positions, indices) => addBox(positions, indices, 0, torsoY - torsoH / 2 + 0.08, 0.13, torsoW * 0.7, 0.05, 0.03));
  }
  paint(body, skin, (positions, indices) => addBox(positions, indices, 0, 1.4, 0, 0.12, 0.14, 0.12));
  const legTop = dress ? 0.58 : 0.78;
  paint(body, shade(top, 0.45), (positions, indices) => {
    addBox(positions, indices, -0.08, legTop - 0.28, 0, 0.12, 0.46, 0.12);
    addBox(positions, indices, 0.08, legTop - 0.28, 0, 0.12, 0.46, 0.12);
  });
  paint(body, [0.16, 0.16, 0.18], (positions, indices) => {
    addBox(positions, indices, -0.08, 0.08, 0.03, 0.13, 0.08, 0.18);
    addBox(positions, indices, 0.08, 0.08, 0.03, 0.13, 0.08, 0.18);
  });

  if (headSpec.kind === "box") {
    paint(head, skin, (positions, indices) => addBox(positions, indices, 0, 0, 0, headSpec.rx * 2, headSpec.ry * 2, headSpec.rz * 2));
  } else {
    paint(head, skin, (positions, indices) => addEllipsoid(positions, indices, 0, 0, 0, headSpec.rx, headSpec.ry, headSpec.rz, 8, 5));
  }
  paint(head, shade(skin, 0.92), (positions, indices) => addBox(positions, indices, 0, -0.01, frontZ + 0.02, 0.045, 0.07, 0.05));

  const eye = config.eyes === "almond"
    ? { rx: 0.045, ry: 0.026 }
    : config.eyes === "wide"
      ? { rx: 0.055, ry: 0.036 }
      : { rx: 0.04, ry: 0.04 };
  for (const side of [-1, 1]) {
    const ex = side * 0.07;
    paint(head, [0.95, 0.95, 0.96], (positions, indices) => addEllipsoid(positions, indices, ex, 0.045, frontZ, eye.rx, eye.ry, 0.03, 6, 4));
    paint(head, iris, (positions, indices) => addEllipsoid(positions, indices, ex, 0.045, frontZ + 0.02, eye.rx * 0.55, eye.ry * 0.55, 0.02, 5, 3));
    paint(head, [0.08, 0.08, 0.1], (positions, indices) => addEllipsoid(positions, indices, ex, 0.045, frontZ + 0.032, eye.rx * 0.24, eye.ry * 0.24, 0.015, 4, 2));
  }

  const browY = config.brows === "soft" ? 0.105 : 0.095;
  const browH = config.brows === "thick" ? 0.02 : 0.012;
  const browRot = config.brows === "arched" ? 0.45 : config.brows === "soft" ? 0.2 : 0;
  paint(head, shade(hair, 0.85), (positions, indices) => {
    addBox(positions, indices, -0.07, browY, frontZ + 0.02, 0.07, browH, 0.016, browRot);
    addBox(positions, indices, 0.07, browY, frontZ + 0.02, 0.07, browH, 0.016, -browRot);
  });

  const mouthW = config.mouth === "grin" ? 0.12 : config.mouth === "neutral" ? 0.06 : 0.09;
  const mouthY = config.mouth === "smile" || config.mouth === "grin" ? -0.075 : -0.085;
  paint(head, [0.72, 0.34, 0.38], (positions, indices) => addBox(positions, indices, 0, mouthY, frontZ + 0.015, mouthW, 0.018, 0.02));
  if (config.mouth === "smile" || config.mouth === "grin") {
    paint(head, [0.72, 0.34, 0.38], (positions, indices) => {
      addBox(positions, indices, -mouthW / 2, mouthY + 0.01, frontZ + 0.012, 0.02, 0.012, 0.016, 0.5);
      addBox(positions, indices, mouthW / 2, mouthY + 0.01, frontZ + 0.012, 0.02, 0.012, 0.016, -0.5);
    });
  }
  if (config.mouth === "open") {
    paint(head, [0.25, 0.12, 0.14], (positions, indices) => addBox(positions, indices, 0, mouthY - 0.012, frontZ + 0.02, mouthW * 0.7, 0.02, 0.012));
  }

  if (config.hair !== "bald") {
    const capY = headSpec.ry * 0.35;
    if (config.hair === "short" || config.hair === "bob" || config.hair === "long" || config.hair === "bun") {
      paint(head, hair, (positions, indices) => addEllipsoid(positions, indices, 0, capY, -0.01, headSpec.rx * 1.08, headSpec.ry * 0.72, headSpec.rz * 1.08, 8, 4));
    }
    if (config.hair === "bob" || config.hair === "long") {
      const drop = config.hair === "long" ? 0.28 : 0.12;
      paint(head, hair, (positions, indices) => {
        addBox(positions, indices, -headSpec.rx * 0.92, -drop * 0.2, 0, 0.06, drop, headSpec.rz * 1.3);
        addBox(positions, indices, headSpec.rx * 0.92, -drop * 0.2, 0, 0.06, drop, headSpec.rz * 1.3);
      });
    }
    if (config.hair === "bun") {
      paint(head, hair, (positions, indices) => addEllipsoid(positions, indices, 0, headSpec.ry + 0.06, -0.04, 0.07, 0.07, 0.07, 6, 4));
    }
    if (config.hair === "curly") {
      for (const [x, y, z] of [[-0.1, 0.12, 0.04], [0.1, 0.12, 0.04], [0, 0.18, 0], [-0.12, 0.02, -0.02], [0.12, 0.02, -0.02], [0, 0.08, -0.1]] as const) {
        paint(head, hair, (positions, indices) => addEllipsoid(positions, indices, x, y, z, 0.07, 0.07, 0.07, 5, 3));
      }
    }
    if (config.hair === "mohawk") {
      paint(head, hair, (positions, indices) => {
        addBox(positions, indices, 0, headSpec.ry * 0.7, 0, 0.06, 0.16, 0.22);
        addBox(positions, indices, 0, headSpec.ry + 0.04, -0.02, 0.05, 0.1, 0.08);
      });
    }
  }

  if (config.facialHair === "mustache" || config.facialHair === "beard") {
    paint(head, hair, (positions, indices) => addBox(positions, indices, 0, -0.055, frontZ + 0.02, 0.1, 0.028, 0.03));
  }
  if (config.facialHair === "beard") {
    paint(head, hair, (positions, indices) => addBox(positions, indices, 0, -0.15, frontZ * 0.45, 0.16, 0.12, 0.12));
  }
  if (config.facialHair === "stubble") {
    paint(head, shade(skin, 0.72), (positions, indices) => addBox(positions, indices, 0, -0.12, frontZ * 0.55, 0.14, 0.08, 0.06));
  }

  if (config.glasses === "sun") {
    paint(head, [0.08, 0.09, 0.12], (positions, indices) => {
      addBox(positions, indices, -0.07, 0.045, frontZ + 0.04, 0.09, 0.055, 0.012);
      addBox(positions, indices, 0.07, 0.045, frontZ + 0.04, 0.09, 0.055, 0.012);
      addBox(positions, indices, 0, 0.045, frontZ + 0.04, 0.04, 0.012, 0.012);
    });
  } else if (config.glasses !== "none") {
    const wide = config.glasses === "rect" ? 0.09 : 0.075;
    paint(head, [0.12, 0.12, 0.14], (positions, indices) => {
      for (const side of [-1, 1]) {
        const ex = side * 0.07;
        addBox(positions, indices, ex, 0.045 + eye.ry, frontZ + 0.035, wide, 0.012, 0.012);
        addBox(positions, indices, ex, 0.045 - eye.ry, frontZ + 0.035, wide, 0.012, 0.012);
        addBox(positions, indices, ex - wide / 2, 0.045, frontZ + 0.035, 0.012, eye.ry * 2, 0.012);
        addBox(positions, indices, ex + wide / 2, 0.045, frontZ + 0.035, 0.012, eye.ry * 2, 0.012);
      }
      addBox(positions, indices, 0, 0.045, frontZ + 0.035, 0.035, 0.01, 0.01);
    });
  }

  if (config.accessory === "earrings") {
    paint(head, accent, (positions, indices) => {
      addEllipsoid(positions, indices, -headSpec.rx - 0.01, -0.04, 0, 0.022, 0.022, 0.022, 4, 3);
      addEllipsoid(positions, indices, headSpec.rx + 0.01, -0.04, 0, 0.022, 0.022, 0.022, 4, 3);
    });
  }
  if (config.accessory === "cap") {
    paint(head, accent, (positions, indices) => {
      addEllipsoid(positions, indices, 0, headSpec.ry * 0.45, 0, headSpec.rx * 1.05, headSpec.ry * 0.55, headSpec.rz * 1.05, 8, 4);
      addBox(positions, indices, 0, 0.04, frontZ + 0.06, 0.28, 0.025, 0.14);
    });
  }
  if (config.accessory === "headphones") {
    paint(head, [0.15, 0.15, 0.18], (positions, indices) => {
      addEllipsoid(positions, indices, -headSpec.rx - 0.01, 0.02, 0, 0.05, 0.06, 0.05, 5, 3);
      addEllipsoid(positions, indices, headSpec.rx + 0.01, 0.02, 0, 0.05, 0.06, 0.05, 5, 3);
      addBox(positions, indices, 0, headSpec.ry + 0.02, 0, headSpec.rx * 2.1, 0.035, 0.035);
    });
  }
  if (config.outfit === "hoodie") {
    paint(head, top, (positions, indices) => addEllipsoid(positions, indices, 0, 0.02, -headSpec.rz * 0.35, headSpec.rx * 1.15, headSpec.ry * 1.05, headSpec.rz * 0.85, 8, 4));
  }

  const sleeve = dress ? skin : top;
  const addArm = (target: Bucket, thumb: boolean) => {
    paint(target, sleeve, (positions, indices) => addBox(positions, indices, 0, -0.14, 0, 0.1, 0.26, 0.1));
    paint(target, skin, (positions, indices) => {
      addBox(positions, indices, 0, -0.36, 0, 0.09, 0.22, 0.09);
      addBox(positions, indices, 0, -0.52, 0.01, 0.1, 0.1, 0.06);
    });
    if (thumb) {
      paint(target, skin, (positions, indices) => addBox(positions, indices, 0.055, -0.46, 0.02, 0.035, 0.08, 0.035));
    }
  };
  addArm(armL, false);
  addArm(armR, true);

  const groups: Array<[AvatarGroup, Bucket]> = [["body", body], ["head", head], ["armL", armL], ["armR", armR]];
  const meshes = groups.map(([group, source]) => ({
    group,
    positions: Float32Array.from(source.positions),
    colors: Float32Array.from(source.colors),
    indices: Uint16Array.from(source.indices),
  })).filter((mesh) => mesh.indices.length > 0);
  let triangles = 0;
  let vertices = 0;
  for (const mesh of meshes) {
    triangles += mesh.indices.length / 3;
    vertices += mesh.positions.length / 3;
  }
  return { meshes, pivots, stats: { triangles, vertices, drawCalls: meshes.length } };
}

export type BakedAvatar = {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint16Array;
};

export function bakeAvatar(model: AvatarModel, pose: Pose = idlePose(0)): BakedAvatar {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const mesh of model.meshes) {
    const matrix = groupMatrix(mesh.group, pose, model.pivots);
    const offset = positions.length / 3;
    for (let index = 0; index < mesh.positions.length; index += 3) {
      const point = transformPoint(matrix, mesh.positions[index]!, mesh.positions[index + 1]!, mesh.positions[index + 2]!);
      positions.push(point[0], point[1], point[2]);
    }
    for (const value of mesh.colors) colors.push(value);
    for (const index of mesh.indices) indices.push(index + offset);
  }
  return {
    positions: Float32Array.from(positions),
    colors: Float32Array.from(colors),
    indices: Uint16Array.from(indices),
  };
}

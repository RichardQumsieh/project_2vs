import type { GreetingAnimation } from "./config";
import { multiply, rotateX, rotateY, rotateZ, translate, type Mat4, type Vec3 } from "./mat4";

export type AvatarAnimation = GreetingAnimation | "subtleWave" | "idle";

export type Pose = {
  bodyY: number;
  bodyRotY: number;
  headRotX: number;
  headRotY: number;
  armLRotX: number;
  armRRotX: number;
  armRRotZ: number;
};

export type AvatarGroup = "body" | "head" | "armL" | "armR";

export type Pivots = { head: Vec3; armL: Vec3; armR: Vec3 };

const DURATION_MS: Record<AvatarAnimation, number> = {
  idle: Number.POSITIVE_INFINITY,
  wave: 2200,
  nod: 1600,
  "thumbs-up": 1800,
  dance: 2400,
  subtleWave: 1400,
};

export function animationDuration(animation: AvatarAnimation): number {
  return DURATION_MS[animation];
}

export function idlePose(elapsedMs = 0): Pose {
  return {
    bodyY: Math.sin(elapsedMs / 1000 * 1.6) * 0.012,
    bodyRotY: 0,
    headRotX: 0,
    headRotY: 0,
    armLRotX: 0,
    armRRotX: 0,
    armRRotZ: 0,
  };
}

export function poseAt(animation: AvatarAnimation, elapsedMs: number, playing: boolean): Pose {
  const pose = idlePose(playing ? 0 : elapsedMs);
  if (!playing || animation === "idle") return idlePose(elapsedMs);
  const duration = DURATION_MS[animation];
  if (elapsedMs >= duration) return idlePose(0);
  const u = elapsedMs / duration;
  const envelope = Math.sin(Math.PI * u);
  if (animation === "wave" || animation === "subtleWave") {
    const lift = animation === "wave" ? 2.35 : 1.2;
    const flaps = animation === "wave" ? 3 : 2;
    pose.bodyY = 0;
    pose.armRRotX = -lift * envelope;
    pose.armRRotZ = Math.sin(u * Math.PI * flaps) * (animation === "wave" ? 0.22 : 0.1);
    return pose;
  }
  if (animation === "nod") {
    pose.bodyY = 0;
    pose.headRotX = Math.sin(u * Math.PI * 2) * 0.38;
    return pose;
  }
  if (animation === "thumbs-up") {
    const hold = u < 0.72 ? Math.min(1, u / 0.28) : 1 - (u - 0.72) / 0.28;
    pose.bodyY = 0;
    pose.armRRotX = -2.45 * hold;
    pose.armRRotZ = -0.35 * hold;
    return pose;
  }
  pose.bodyRotY = Math.sin(u * Math.PI * 4) * 0.32;
  pose.bodyY = Math.abs(Math.sin(u * Math.PI * 4)) * 0.05;
  pose.armLRotX = -1.15 * Math.sin(u * Math.PI * 2);
  pose.armRRotX = -1.15 * Math.sin(u * Math.PI * 2 + Math.PI);
  pose.headRotY = Math.sin(u * Math.PI * 4) * 0.18;
  return pose;
}

export function groupMatrix(group: AvatarGroup, pose: Pose, pivots: Pivots): Mat4 {
  const body = multiply(
    multiply(translate(0, 1 + pose.bodyY, 0), rotateY(pose.bodyRotY)),
    translate(0, -1, 0),
  );
  if (group === "body") return body;
  if (group === "head") {
    const [x, y, z] = pivots.head;
    return multiply(
      body,
      multiply(multiply(translate(x, y, z), rotateY(pose.headRotY)), rotateX(pose.headRotX)),
    );
  }
  const [x, y, z] = group === "armL" ? pivots.armL : pivots.armR;
  const rotX = group === "armL" ? pose.armLRotX : pose.armRRotX;
  const rotZ = group === "armR" ? pose.armRRotZ : 0;
  return multiply(body, multiply(multiply(translate(x, y, z), rotateZ(rotZ)), rotateX(rotX)));
}

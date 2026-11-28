import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import React, { useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { parseAvatarConfig, type AvatarConfig, type AvatarPerson } from "../../frontend/lib/avatar/config";
import { buildAvatar } from "../../frontend/lib/avatar/geometry";
import { createAvatarRenderer } from "../../frontend/lib/avatar/gl";
import { prefersStaticAvatars, presentationMode } from "../../frontend/lib/avatar/greeting";
import { poseAt, type AvatarAnimation } from "../../frontend/lib/avatar/pose";
import { useAvatarPrefs } from "./avatar-prefs";
import { PersonBadge } from "./person-badge";

function AvatarGl({
  config,
  animation,
  playing,
  size,
  onFail,
}: {
  config: AvatarConfig;
  animation: AvatarAnimation;
  playing: boolean;
  size: number;
  onFail: () => void;
}) {
  const stop = useRef<(() => void) | null>(null);
  const animationRef = useRef(animation);
  const playingRef = useRef(playing);
  animationRef.current = animation;
  playingRef.current = playing;
  useEffect(() => () => stop.current?.(), []);
  return (
    <GLView
      style={{ width: size, height: size }}
      onContextCreate={(gl: ExpoWebGLRenderingContext) => {
        try {
          const renderer = createAvatarRenderer(gl, buildAvatar(config));
          let frame = 0;
          const started = Date.now();
          let alive = true;
          const loop = () => {
            if (!alive) return;
            frame = requestAnimationFrame(loop);
            renderer.draw(
              poseAt(animationRef.current, Date.now() - started, playingRef.current),
              gl.drawingBufferWidth,
              gl.drawingBufferHeight,
            );
            gl.endFrameEXP();
          };
          loop();
          stop.current = () => {
            alive = false;
            cancelAnimationFrame(frame);
            renderer.dispose();
          };
        } catch {
          onFail();
        }
      }}
    />
  );
}

export function AvatarStage({
  person,
  size,
  animation = "idle",
  playing = true,
}: {
  person?: AvatarPerson | null;
  size: number;
  animation?: AvatarAnimation;
  playing?: boolean;
}) {
  const prefs = useAvatarPrefs();
  const config = parseAvatarConfig(person?.avatarConfig);
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [glFailed, setGlFailed] = useState(false);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => subscription.remove();
  }, []);
  const mode = presentationMode({
    focused: appActive,
    staticAvatars: prefersStaticAvatars(prefs, false),
    glFailed,
  });
  if (!config || mode === "still") return <PersonBadge person={person} size={size} />;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden", backgroundColor: "#F0ECF7" }}>
      <AvatarGl config={config} animation={animation} playing={playing} size={size} onFail={() => setGlFailed(true)} />
    </View>
  );
}

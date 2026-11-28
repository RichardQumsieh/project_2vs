"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import type { AvatarConfig } from "@/lib/avatar/config";
import { buildAvatar, type DrawMesh } from "@/lib/avatar/geometry";
import { groupMatrix, poseAt, type AvatarAnimation } from "@/lib/avatar/pose";

function geometryFor(mesh: DrawMesh) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3));
  geometry.setIndex(Array.from(mesh.indices));
  geometry.computeVertexNormals();
  return geometry;
}

function Rig({
  config,
  animation,
  playing,
}: {
  config: AvatarConfig;
  animation: AvatarAnimation;
  playing: boolean;
}) {
  const model = useMemo(() => buildAvatar(config), [config]);
  const geometries = useMemo(() => model.meshes.map(geometryFor), [model]);
  useEffect(() => () => {
    for (const geometry of geometries) geometry.dispose();
  }, [geometries]);
  const meshes = useRef<Array<THREE.Mesh | null>>([]);
  const started = useRef(0);
  const playingRef = useRef(playing);
  useFrame((state) => {
    if (playingRef.current !== playing) {
      playingRef.current = playing;
      started.current = state.clock.elapsedTime;
    }
    if (started.current === 0) started.current = state.clock.elapsedTime;
    const pose = poseAt(animation, (state.clock.elapsedTime - started.current) * 1000, playing);
    model.meshes.forEach((mesh, index) => {
      const object = meshes.current[index];
      if (!object) return;
      object.matrixAutoUpdate = false;
      object.matrix.fromArray(groupMatrix(mesh.group, pose, model.pivots));
      object.matrixWorldNeedsUpdate = true;
    });
  });
  return (
    <group>
      {model.meshes.map((mesh, index) => (
        <mesh
          key={mesh.group}
          ref={(node) => { meshes.current[index] = node; }}
          geometry={geometries[index]}
          frustumCulled={false}
        >
          <meshStandardMaterial vertexColors roughness={0.72} metalness={0.02} />
        </mesh>
      ))}
    </group>
  );
}

function Aim() {
  const camera = useThree((state) => state.camera);
  useLayoutEffect(() => {
    camera.position.set(0, 1.15, 2.7);
    camera.lookAt(0, 1.05, 0);
  }, [camera]);
  return null;
}

class StageBoundary extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onFail();
  }

  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

export function LiveAvatar({
  config,
  animation,
  playing,
  onFail,
}: {
  config: AvatarConfig;
  animation: AvatarAnimation;
  playing: boolean;
  onFail: () => void;
}) {
  const disposed = useRef(false);
  useEffect(() => () => {
    disposed.current = true;
  }, []);
  // Unmounting the canvas (static avatars, hiding the tab, scrolling it offscreen)
  // loses the WebGL context. That is not a device failure. Report it only if the
  // view is still mounted when the event is delivered.
  const failIfMounted = () => {
    queueMicrotask(() => {
      if (!disposed.current) onFail();
    });
  };
  return (
    <StageBoundary onFail={failIfMounted}>
      <Canvas
        className="size-full"
        dpr={1}
        frameloop="always"
        gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", (event) => {
            event.preventDefault();
            failIfMounted();
          });
        }}
      >
        <Aim />
        <ambientLight intensity={0.72} />
        <directionalLight position={[1.1, 2.1, 2.2]} intensity={1.15} />
        <Rig config={config} animation={animation} playing={playing} />
      </Canvas>
    </StageBoundary>
  );
}

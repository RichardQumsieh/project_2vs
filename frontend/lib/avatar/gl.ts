import type { AvatarModel, DrawMesh } from "./geometry";
import { lookAt, multiply, perspective, type Mat4 } from "./mat4";
import { groupMatrix, type Pose } from "./pose";

const VERT = `
attribute vec3 position;
attribute vec3 color;
uniform mat4 mvp;
varying vec3 vColor;
void main() {
  vColor = color;
  gl_Position = mvp * vec4(position, 1.0);
}
`;

const FRAG = `
precision mediump float;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
}
`;

export type AvatarGl = WebGLRenderingContext & {
  bindAttribLocation?(program: WebGLProgram, index: number, name: string): void;
};

type Buffered = {
  mesh: DrawMesh;
  position: WebGLBuffer;
  color: WebGLBuffer;
  index: WebGLBuffer;
};

export type AvatarRenderer = {
  draw: (pose: Pose, width: number, height: number) => void;
  dispose: () => void;
};

function shader(gl: AvatarGl, type: number, source: string): WebGLShader {
  const compiled = gl.createShader(type);
  if (!compiled) throw new Error("Could not create an avatar shader.");
  gl.shaderSource(compiled, source);
  gl.compileShader(compiled);
  if (!gl.getShaderParameter(compiled, gl.COMPILE_STATUS)) {
    gl.deleteShader(compiled);
    throw new Error("Could not compile the avatar shader.");
  }
  return compiled;
}

export function createAvatarRenderer(gl: AvatarGl, model: AvatarModel): AvatarRenderer {
  const vertex = shader(gl, gl.VERTEX_SHADER, VERT);
  const fragment = shader(gl, gl.FRAGMENT_SHADER, FRAG);
  const program = gl.createProgram();
  if (!program) throw new Error("Could not create the avatar program.");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation?.(program, 0, "position");
  gl.bindAttribLocation?.(program, 1, "color");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    throw new Error("Could not link the avatar program.");
  }
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  const positionLoc = gl.getAttribLocation(program, "position");
  const colorLoc = gl.getAttribLocation(program, "color");
  const mvpLoc = gl.getUniformLocation(program, "mvp");
  const buffers: Buffered[] = [];
  for (const mesh of model.meshes) {
    const position = gl.createBuffer();
    const color = gl.createBuffer();
    const index = gl.createBuffer();
    if (!position || !color || !index) throw new Error("Could not allocate avatar buffers.");
    gl.bindBuffer(gl.ARRAY_BUFFER, position);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, color);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.colors, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    buffers.push({ mesh, position, color, index });
  }

  const draw = (pose: Pose, width: number, height: number) => {
    const aspect = width / Math.max(1, height);
    const projection = perspective((28 * Math.PI) / 180, aspect, 0.1, 20);
    const view = lookAt([0, 1.15, 2.7], [0, 1.05, 0], [0, 1, 0]);
    const viewProjection = multiply(projection, view);
    gl.viewport(0, 0, width, height);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    for (const buffer of buffers) {
      const mvp: Mat4 = multiply(viewProjection, groupMatrix(buffer.mesh.group, pose, model.pivots));
      gl.uniformMatrix4fv(mvpLoc, false, mvp);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer.position);
      gl.enableVertexAttribArray(positionLoc);
      gl.vertexAttribPointer(positionLoc, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer.color);
      gl.enableVertexAttribArray(colorLoc);
      gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer.index);
      gl.drawElements(gl.TRIANGLES, buffer.mesh.indices.length, gl.UNSIGNED_SHORT, 0);
    }
  };

  const dispose = () => {
    for (const buffer of buffers) {
      gl.deleteBuffer(buffer.position);
      gl.deleteBuffer(buffer.color);
      gl.deleteBuffer(buffer.index);
    }
    gl.deleteProgram(program);
  };

  return { draw, dispose };
}

export const AVATAR_DRAW_CALL_BUDGET = 4;

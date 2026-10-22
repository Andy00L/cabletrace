// From the Anatomy kit (github.com/wheresryan22/anatomy, kit/gl.mjs), MIT licence: see ./LICENSE. The GLSL camera
// prelude, glCamera and glLayer, ported from JavaScript to typed TypeScript with the same maths; the 3D-mode chunks
// (GLSL_TURN, glslPose) are left out. glLayer returns null without WebGL or on a compile error, so every caller guards.
import type { Projection } from "./iso-kit";

export const GLSL_ISO = `precision highp float;
uniform vec2 uCanvas;
uniform vec2 uView;
uniform vec2 uOrigin;
uniform float uK;
uniform vec4 uCam;
uniform float uTime;
vec2 viewOf(vec2 frag){return vec2(frag.x,uCanvas.y-frag.y)*(uView.x/uCanvas.x);}
vec2 project(vec3 p){return uOrigin+uK*vec2(p.x*uCam.x-p.y*uCam.y,(p.x*uCam.y+p.y*uCam.x)*uCam.z-p.z*uCam.w);}
vec3 towardViewer(){return vec3(uCam.y*uCam.w,uCam.x*uCam.w,uCam.z);}
vec3 rayOf(vec2 vb){vec2 q=(vb-uOrigin)/uK;return vec3(q.x*uCam.x,-q.x*uCam.y,-q.y/uCam.w);}
float pixelOf(){return (uView.x/uCanvas.x)/uK;}
vec3 lightDir(){return normalize(vec3(-uCam.x,uCam.y,1.2));}
vec3 onFloor(vec2 vb,float h){vec2 q=(vb-uOrigin)/uK;float b=(q.y+h*uCam.w)/uCam.z;return vec3(q.x*uCam.x+b*uCam.y,-q.x*uCam.y+b*uCam.x,h);}
vec3 onWallY(vec2 vb,float y){vec2 q=(vb-uOrigin)/uK;float x=(q.x+y*uCam.y)/uCam.x;return vec3(x,y,((x*uCam.y+y*uCam.x)*uCam.z-q.y)/uCam.w);}
vec3 onWallX(vec2 vb,float x){vec2 q=(vb-uOrigin)/uK;float y=(x*uCam.x-q.x)/uCam.y;return vec3(x,y,((x*uCam.y+y*uCam.x)*uCam.z-q.y)/uCam.w);}
float hash12(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float hash13(vec3 p){p=fract(p*.1031);p+=dot(p,p.zyx+31.32);return fract((p.x+p.y)*p.z);}
float noise2(vec2 p){vec2 i=floor(p);vec2 f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash12(i),hash12(i+vec2(1.,0.)),f.x),mix(hash12(i+vec2(0.,1.)),hash12(i+vec2(1.,1.)),f.x),f.y);}
float noise3(vec3 p){vec3 i=floor(p);vec3 f=fract(p);f=f*f*(3.-2.*f);
  float a=mix(mix(hash13(i),hash13(i+vec3(1.,0.,0.)),f.x),mix(hash13(i+vec3(0.,1.,0.)),hash13(i+vec3(1.,1.,0.)),f.x),f.y);
  float b=mix(mix(hash13(i+vec3(0.,0.,1.)),hash13(i+vec3(1.,0.,1.)),f.x),mix(hash13(i+vec3(0.,1.,1.)),hash13(i+vec3(1.,1.,1.)),f.x),f.y);
  return mix(a,b,f.z);}
float fbm2(vec2 p){float s=0.;float a=.5;for(int i=0;i<4;i++){s+=a*noise2(p);p=p*2.07+vec2(17.1,9.2);a*=.5;}return s/.9375;}
float fbm3(vec3 p){float s=0.;float a=.5;for(int i=0;i<4;i++){s+=a*noise3(p);p=p*2.07+vec3(17.1,9.2,4.7);a*=.5;}return s/.9375;}
float window(float x,float a,float b,float soft){return smoothstep(a-soft,a+soft,x)*(1.-smoothstep(b-soft,b+soft,x));}
vec3 tonemap(vec3 c,float exposure){return 1.-exp(-c*exposure);}
`;

export type GlCamera = { origin: [number, number]; k: number; cam: [number, number, number, number] };

export function glCamera(projection: Projection): GlCamera {
  const a = ((projection.azimuth ?? 45) * Math.PI) / 180;
  const e = ((projection.elevation ?? 30) * Math.PI) / 180;
  return {
    origin: [projection.origin[0], projection.origin[1]],
    k: projection.scale * Math.sqrt(1.6),
    cam: [Math.sin(a), Math.cos(a), Math.sin(e), Math.cos(e)],
  };
}

export type UniformValue = number | readonly number[] | Float32Array;

export type GlLayer = {
  gl: WebGLRenderingContext;
  set: (values: Record<string, UniformValue>) => void;
  draw: (values: Record<string, UniformValue>, time: number) => void;
  clear: () => void;
};

const VERTEX = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";

export function glLayer(input: {
  canvas: HTMLCanvasElement;
  fragment: string;
  view: [number, number];
  camera: GlCamera;
  uniforms?: string[];
  fixed?: Record<string, UniformValue>;
  maxRatio?: number;
  onError?: (message: string) => void;
}): GlLayer | null {
  const { canvas, fragment, view, camera, uniforms = [], fixed = {}, maxRatio = 1.5 } = input;
  const onError = input.onError ?? ((message: string) => console.error(`[glLayer] ${message}`));
  const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    onError(gl.getShaderInfoLog(shader) ?? "shader did not compile");
    return null;
  };
  const vertexShader = compile(gl.VERTEX_SHADER, VERTEX);
  const fragmentShader = compile(gl.FRAGMENT_SHADER, GLSL_ISO + fragment);
  const program = gl.createProgram();
  if (!vertexShader || !fragmentShader || !program) return null;
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    onError(gl.getProgramInfoLog(program) ?? "program did not link");
    return null;
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const locations = new Map<string, WebGLUniformLocation | null>();
  for (const name of ["uCanvas", "uView", "uOrigin", "uK", "uCam", "uTime", ...uniforms, ...Object.keys(fixed)]) locations.set(name, gl.getUniformLocation(program, name));
  let isPainted = false;
  const fitCanvas = () => {
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(maxRatio, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(box.width * ratio));
    const height = Math.max(1, Math.round(box.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };
  const setUniform = (name: string, value: UniformValue) => {
    const location = locations.get(name);
    if (!location) return;
    if (typeof value === "number") gl.uniform1f(location, value);
    else if (value.length === 1) gl.uniform1f(location, value[0] ?? 0);
    else if (value.length === 2) gl.uniform2f(location, value[0] ?? 0, value[1] ?? 0);
    else if (value.length === 3) gl.uniform3f(location, value[0] ?? 0, value[1] ?? 0, value[2] ?? 0);
    else if (value.length === 4) gl.uniform4f(location, value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 0);
    else gl.uniform1fv(location, value instanceof Float32Array ? value : new Float32Array(value));
  };
  for (const [name, value] of Object.entries(fixed)) setUniform(name, value);
  return {
    gl,
    set(values) {
      for (const [name, value] of Object.entries(values)) setUniform(name, value);
    },
    draw(values, time) {
      fitCanvas();
      gl.viewport(0, 0, canvas.width, canvas.height);
      setUniform("uCanvas", [canvas.width, canvas.height]);
      setUniform("uView", view);
      setUniform("uOrigin", camera.origin);
      setUniform("uK", camera.k);
      setUniform("uCam", camera.cam);
      setUniform("uTime", time);
      for (const [name, value] of Object.entries(values)) setUniform(name, value);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      isPainted = true;
    },
    clear() {
      if (!isPainted) return;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      isPainted = false;
    },
  };
}

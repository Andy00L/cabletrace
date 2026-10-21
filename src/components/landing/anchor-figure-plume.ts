import { iso, type Flat } from "@/components/iso/iso-kit";
import type { FigureView } from "@/components/landing/anchor-figure-view";

// The silt the flukes throw up behind the anchor while it ploughs: the one thing in the figure lines cannot draw, so it
// is a WebGL haze in the figure's own camera (the kit's GLSL_ISO prelude), with a stipple of dots as the SVG fallback.
// The cloud lives in world space: it is thrown up at the flukes, then rises, widens and thins with its age, which is
// its distance aft of the flukes over the ship's speed. Ink on paper: normal premultiplied alpha, never screen.

/** How the cloud grows behind the flukes (m): its height and half width at the flukes, and their growth per metre aft. */
const PLUME = { height: 1.6, heightGrowth: 0.085, halfWidth: 3.2, widthGrowth: 0.07, reach: 110 } as const;

/**
 * The cloud's box on screen (view-box x0, y0, x1, y1) for the flukes at `flukeX`, padded: the shader returns at once
 * outside it, so only the few thousand pixels the cloud can reach pay for the march. The cloud is 0 well inside it.
 */
export function plumeScreenBounds(view: FigureView, flukeX: number): [number, number, number, number] {
  const halfWidth = (PLUME.halfWidth + PLUME.widthGrowth * PLUME.reach) * 1.3;
  const top = (PLUME.height + PLUME.heightGrowth * PLUME.reach) * 2.6;
  const corners: Flat[] = [];
  for (const alongX of [flukeX - PLUME.reach, flukeX + 4]) {
    for (const acrossY of [view.chainY - halfWidth, view.chainY + halfWidth]) for (const upZ of [0, top]) corners.push(iso([alongX, acrossY, upZ], view.projection));
  }
  const xs = corners.map(([screenX]) => screenX);
  const ys = corners.map(([, screenY]) => screenY);
  return [Math.min(...xs) - 4, Math.min(...ys) - 4, Math.max(...xs) + 4, Math.max(...ys) + 4];
}

/**
 * The fragment shader, after GLSL_ISO. Uniforms: uFluke (the fluke tips' x and y in the block), uRunStart (block x
 * where the flukes went in: no silt ahead of it), uTravel (metres the ship has covered, so the noise stays put in the
 * world while the block slides), uActive (0 to 1, the ploughing envelope), uSilt (the ink's colour, read from the
 * figure's token), uBlock (the block's x ends).
 */
export const PLUME_FRAGMENT = `
uniform vec2 uFluke;
uniform float uRunStart;
uniform float uTravel;
uniform float uActive;
uniform vec3 uSilt;
uniform vec2 uBlock;
uniform vec4 uBounds;
const float H0=${PLUME.height.toFixed(2)};
const float HG=${PLUME.heightGrowth.toFixed(3)};
const float W0=${PLUME.halfWidth.toFixed(2)};
const float WG=${PLUME.widthGrowth.toFixed(3)};
const float REACH=${PLUME.reach.toFixed(1)};
float densityAt(vec3 point){
  float aft=uFluke.x-point.x;
  // Born at the flukes (a short soft ramp ahead of them), gone by REACH aft, and only where the flukes have been.
  float born=smoothstep(-1.5,2.5,aft)*(1.-smoothstep(REACH*.55,REACH,aft));
  float ploughed=smoothstep(uRunStart-2.,uRunStart+6.,point.x);
  float inBlock=smoothstep(uBlock.x,uBlock.x+8.,point.x);
  float height=H0+HG*max(aft,0.);
  float width=W0+WG*max(aft,0.);
  float across=(point.y-uFluke.y)/width;
  float up=point.z/height;
  float body=exp(-across*across*1.6-up*up*1.3);
  vec3 world=vec3(point.x+uTravel,point.y,point.z);
  float grain=fbm3(world*vec3(.11,.16,.24)+vec3(0.,0.,-uTime*.18));
  float fade=exp(-max(aft,0.)/(REACH*.42));
  return body*born*ploughed*inBlock*fade*(.45+.9*grain);
}
void main(){
  vec2 vb=viewOf(gl_FragCoord.xy);
  vec3 start=onFloor(vb,0.);
  // The ray starts on the seabed's plane even beyond the block's far edge: the cloud's top is seen there against the
  // water, so there is no test on y (it would cut the cloud along the edge). The cloud itself stays inside the block.
  if(uActive<.002||vb.x<uBounds.x||vb.y<uBounds.y||vb.x>uBounds.z||vb.y>uBounds.w){gl_FragColor=vec4(0.);return;}
  vec3 toward=towardViewer();
  float topT=(H0+HG*REACH)*2.6/toward.z;
  const int STEPS=22;
  float dt=topT/float(STEPS);
  float jitter=hash12(gl_FragCoord.xy+fract(uTime*.37)*41.);
  float optical=0.;
  for(int index=0;index<STEPS;index++){
    float along=(float(index)+jitter)*dt;
    optical+=densityAt(start+toward*along)*dt;
  }
  float alpha=(1.-exp(-optical*.12))*uActive*.7;
  float noise=(hash12(gl_FragCoord.xy*1.37+fract(uTime*.61)*57.)-.5)/255.;
  alpha=clamp(alpha+noise*smoothstep(0.,1.5/255.,alpha),0.,1.);
  gl_FragColor=vec4(uSilt*alpha,alpha);
}
`;

/**
 * The fallback: a stipple of dots in the cloud's shape, drawn at the hawse's x and moved to the flukes by a
 * transform, thinning out aft. A deterministic scatter, so the server and the browser draw the same dots.
 */
export function buildPlumeStipple(view: FigureView): [number, number, number][] {
  const dots: [number, number, number][] = [];
  let seed = 20241225;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let index = 0; index < 260; index += 1) {
    const aft = Math.pow(random(), 1.4) * PLUME.reach * 0.7;
    const height = PLUME.height + PLUME.heightGrowth * aft;
    const width = PLUME.halfWidth + PLUME.widthGrowth * aft;
    const across = (random() * 2 - 1) * width * 0.9;
    const up = random() * height * (1 - Math.abs(across) / (width * 1.4));
    const flat: Flat = iso([-aft, view.chainY + across, Math.max(0.2, up)], view.projection);
    // Rounded here so the server's markup and the browser's first render print the same attribute.
    const alpha = Math.round(Math.max(0.08, 0.9 * Math.exp(-aft / (PLUME.reach * 0.32))) * 100) / 100;
    dots.push([flat[0], flat[1], alpha]);
  }
  return dots;
}

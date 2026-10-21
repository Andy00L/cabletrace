// A tube around a polyline, built straight from its points: one ring per point, framed by parallel transport as
// three.js's TubeGeometry frames its rings (computeFrenetFrames), with the same vertex, normal, uv and index layout.
// TubeGeometry samples a spline by arc length for every ring; the map's data lines are already resampled every 300 m
// (overview.ts, LINE_STEP_KM), so their rings can sit on the points themselves. On a phone (the CPU slowed 4 times) the
// spline sampling of the cased cables took about 650 ms of the main thread before the first frame. Three-free: plain
// arrays, so a worker could build it too.

/** A point of the line (scene km). */
export type TubePoint = { x: number; y: number; z: number };

/** The tube's arrays, laid out as TubeGeometry lays them out: `radialSegments + 1` vertices per ring, rings in order. */
export type TubeArrays = { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array };

type Vector = [number, number, number];

function normalize([x, y, z]: Vector): Vector {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function cross([ax, ay, az]: Vector, [bx, by, bz]: Vector): Vector {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

function dot([ax, ay, az]: Vector, [bx, by, bz]: Vector): number {
  return ax * bx + ay * by + az * bz;
}

/** Rotates `vector` about the unit `axis` by `angle` (Rodrigues' formula). */
function rotateAbout(vector: Vector, axis: Vector, angle: number): Vector {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const across = cross(axis, vector);
  const along = dot(axis, vector) * (1 - cosine);
  return [
    vector[0] * cosine + across[0] * sine + axis[0] * along,
    vector[1] * cosine + across[1] * sine + axis[1] * along,
    vector[2] * cosine + across[2] * sine + axis[2] * along,
  ];
}

/** The unit tangent at each point: toward the next point at the start, from the previous at the end, across both between. */
function measureTangents(points: readonly TubePoint[]): Vector[] {
  return points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)] ?? point;
    const next = points[Math.min(points.length - 1, index + 1)] ?? point;
    return normalize([next.x - previous.x, next.y - previous.y, next.z - previous.z]);
  });
}

/**
 * The first normal as TubeGeometry chooses it: perpendicular to the tangent, leaning on the world axis the tangent is
 * least along; each next normal is the previous one turned by the angle between the two tangents (parallel transport).
 */
function transportNormals(tangents: readonly Vector[]): Vector[] {
  const first = tangents[0] ?? [1, 0, 0];
  const magnitudes = first.map(Math.abs);
  const smallest = Math.min(...magnitudes);
  const seed: Vector = magnitudes[0] === smallest ? [1, 0, 0] : magnitudes[1] === smallest ? [0, 1, 0] : [0, 0, 1];
  const firstAcross = normalize(cross(first, seed));
  const normals: Vector[] = [cross(first, firstAcross)];
  for (let index = 1; index < tangents.length; index += 1) {
    const previousTangent = tangents[index - 1] ?? first;
    const tangent = tangents[index] ?? first;
    const previousNormal = normals[index - 1] ?? normals[0] ?? [0, 1, 0];
    const axis = cross(previousTangent, tangent);
    const axisLength = Math.hypot(...axis);
    if (axisLength <= Number.EPSILON) {
      normals.push(previousNormal);
      continue;
    }
    const angle = Math.acos(Math.min(1, Math.max(-1, dot(previousTangent, tangent))));
    normals.push(rotateAbout(previousNormal, normalize(axis), angle));
  }
  return normals;
}

/** A tube of `radius` with `radialSegments` faces around, one ring per point. Needs at least two points. */
export function buildPolylineTube(points: readonly TubePoint[], radius: number, radialSegments: number): TubeArrays {
  const ringCount = points.length;
  const ringSize = radialSegments + 1;
  const tangents = measureTangents(points);
  const normals = transportNormals(tangents);
  const positions = new Float32Array(ringCount * ringSize * 3);
  const vertexNormals = new Float32Array(ringCount * ringSize * 3);
  const uvs = new Float32Array(ringCount * ringSize * 2);
  points.forEach((point, ring) => {
    const tangent = tangents[ring] ?? [1, 0, 0];
    const normal = normals[ring] ?? [0, 1, 0];
    const binormal = cross(tangent, normal);
    for (let around = 0; around <= radialSegments; around += 1) {
      const angle = (around / radialSegments) * Math.PI * 2;
      const sine = Math.sin(angle);
      const cosine = -Math.cos(angle);
      const radialX = cosine * normal[0] + sine * binormal[0];
      const radialY = cosine * normal[1] + sine * binormal[1];
      const radialZ = cosine * normal[2] + sine * binormal[2];
      const vertex = ring * ringSize + around;
      vertexNormals.set(normalize([radialX, radialY, radialZ]), vertex * 3);
      positions[vertex * 3] = point.x + radius * radialX;
      positions[vertex * 3 + 1] = point.y + radius * radialY;
      positions[vertex * 3 + 2] = point.z + radius * radialZ;
      uvs[vertex * 2] = ring / Math.max(1, ringCount - 1);
      uvs[vertex * 2 + 1] = around / radialSegments;
    }
  });
  const indices = new Uint32Array(Math.max(0, ringCount - 1) * radialSegments * 6);
  let cursor = 0;
  for (let ring = 1; ring < ringCount; ring += 1) {
    for (let around = 1; around <= radialSegments; around += 1) {
      const behindLeft = ringSize * (ring - 1) + (around - 1);
      const aheadLeft = ringSize * ring + (around - 1);
      const aheadRight = ringSize * ring + around;
      const behindRight = ringSize * (ring - 1) + around;
      indices.set([behindLeft, aheadLeft, behindRight, aheadLeft, aheadRight, behindRight], cursor);
      cursor += 6;
    }
  }
  return { positions, normals: vertexNormals, uvs, indices };
}

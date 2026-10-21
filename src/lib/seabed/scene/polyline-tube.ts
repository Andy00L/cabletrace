// A tube around a polyline, built straight from its points: one ring per point, framed by parallel transport as
// three.js's TubeGeometry frames its rings (computeFrenetFrames), with the same vertex, normal, uv and index layout.
// TubeGeometry samples a spline by arc length for every ring; the map's data lines are already resampled every 300 m
// (overview.ts, LINE_STEP_KM), so their rings can sit on the points themselves. On a phone (the CPU slowed 4 times) the
// spline sampling of the cased cables took about 650 ms of the main thread before the first frame. Written with plain
// numbers and typed arrays, no small array per vertex, since it runs for every ring of every line. Three-free.

/** A point of the line (scene km). */
export type TubePoint = { x: number; y: number; z: number };

/** The tube's arrays, laid out as TubeGeometry lays them out: `radialSegments + 1` vertices per ring, rings in order. */
export type TubeArrays = { positions: Float32Array; normals: Float32Array; uvs: Float32Array; indices: Uint32Array };

/** The unit tangent at each point (x, y, z per point): toward the next point at the start, from the previous at the end, across both between. */
function measureTangents(points: readonly TubePoint[]): Float64Array {
  const tangents = new Float64Array(points.length * 3);
  points.forEach((point, index) => {
    const previous = points[Math.max(0, index - 1)] ?? point;
    const next = points[Math.min(points.length - 1, index + 1)] ?? point;
    const deltaX = next.x - previous.x;
    const deltaY = next.y - previous.y;
    const deltaZ = next.z - previous.z;
    const length = Math.hypot(deltaX, deltaY, deltaZ) || 1;
    tangents[index * 3] = deltaX / length;
    tangents[index * 3 + 1] = deltaY / length;
    tangents[index * 3 + 2] = deltaZ / length;
  });
  return tangents;
}

/**
 * The ring normals (x, y, z per point) as TubeGeometry chooses them: the first perpendicular to the tangent, leaning on
 * the world axis the tangent is least along; each next one the previous turned by the angle between the two tangents
 * (parallel transport, Rodrigues' rotation).
 */
function transportNormals(tangents: Float64Array, count: number): Float64Array {
  const normals = new Float64Array(count * 3);
  const firstX = tangents[0] ?? 1;
  const firstY = tangents[1] ?? 0;
  const firstZ = tangents[2] ?? 0;
  const smallest = Math.min(Math.abs(firstX), Math.abs(firstY), Math.abs(firstZ));
  const seedX = Math.abs(firstX) === smallest ? 1 : 0;
  const seedY = seedX === 0 && Math.abs(firstY) === smallest ? 1 : 0;
  const seedZ = seedX === 0 && seedY === 0 ? 1 : 0;
  // across = normalize(tangent x seed); normal = tangent x across
  let acrossX = firstY * seedZ - firstZ * seedY;
  let acrossY = firstZ * seedX - firstX * seedZ;
  let acrossZ = firstX * seedY - firstY * seedX;
  const acrossLength = Math.hypot(acrossX, acrossY, acrossZ) || 1;
  acrossX /= acrossLength;
  acrossY /= acrossLength;
  acrossZ /= acrossLength;
  normals[0] = firstY * acrossZ - firstZ * acrossY;
  normals[1] = firstZ * acrossX - firstX * acrossZ;
  normals[2] = firstX * acrossY - firstY * acrossX;
  for (let index = 1; index < count; index += 1) {
    const previousX = tangents[(index - 1) * 3] ?? 0;
    const previousY = tangents[(index - 1) * 3 + 1] ?? 0;
    const previousZ = tangents[(index - 1) * 3 + 2] ?? 0;
    const tangentX = tangents[index * 3] ?? 0;
    const tangentY = tangents[index * 3 + 1] ?? 0;
    const tangentZ = tangents[index * 3 + 2] ?? 0;
    const normalX = normals[(index - 1) * 3] ?? 0;
    const normalY = normals[(index - 1) * 3 + 1] ?? 0;
    const normalZ = normals[(index - 1) * 3 + 2] ?? 0;
    let axisX = previousY * tangentZ - previousZ * tangentY;
    let axisY = previousZ * tangentX - previousX * tangentZ;
    let axisZ = previousX * tangentY - previousY * tangentX;
    const axisLength = Math.hypot(axisX, axisY, axisZ);
    if (axisLength <= Number.EPSILON) {
      normals[index * 3] = normalX;
      normals[index * 3 + 1] = normalY;
      normals[index * 3 + 2] = normalZ;
      continue;
    }
    axisX /= axisLength;
    axisY /= axisLength;
    axisZ /= axisLength;
    const angle = Math.acos(Math.min(1, Math.max(-1, previousX * tangentX + previousY * tangentY + previousZ * tangentZ)));
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const along = (axisX * normalX + axisY * normalY + axisZ * normalZ) * (1 - cosine);
    normals[index * 3] = normalX * cosine + (axisY * normalZ - axisZ * normalY) * sine + axisX * along;
    normals[index * 3 + 1] = normalY * cosine + (axisZ * normalX - axisX * normalZ) * sine + axisY * along;
    normals[index * 3 + 2] = normalZ * cosine + (axisX * normalY - axisY * normalX) * sine + axisZ * along;
  }
  return normals;
}

/** A tube of `radius` with `radialSegments` faces around, one ring per point. Needs at least two points. */
export function buildPolylineTube(points: readonly TubePoint[], radius: number, radialSegments: number): TubeArrays {
  const ringCount = points.length;
  const ringSize = radialSegments + 1;
  const tangents = measureTangents(points);
  const ringNormals = transportNormals(tangents, ringCount);
  const positions = new Float32Array(ringCount * ringSize * 3);
  const normals = new Float32Array(ringCount * ringSize * 3);
  const uvs = new Float32Array(ringCount * ringSize * 2);
  // The angle's sine and cosine around the ring, the same for every ring.
  const sines = new Float64Array(ringSize);
  const cosines = new Float64Array(ringSize);
  for (let around = 0; around <= radialSegments; around += 1) {
    const angle = (around / radialSegments) * Math.PI * 2;
    sines[around] = Math.sin(angle);
    cosines[around] = -Math.cos(angle);
  }
  for (let ring = 0; ring < ringCount; ring += 1) {
    const point = points[ring];
    if (!point) continue;
    const tangentX = tangents[ring * 3] ?? 0;
    const tangentY = tangents[ring * 3 + 1] ?? 0;
    const tangentZ = tangents[ring * 3 + 2] ?? 0;
    const normalX = ringNormals[ring * 3] ?? 0;
    const normalY = ringNormals[ring * 3 + 1] ?? 0;
    const normalZ = ringNormals[ring * 3 + 2] ?? 0;
    const binormalX = tangentY * normalZ - tangentZ * normalY;
    const binormalY = tangentZ * normalX - tangentX * normalZ;
    const binormalZ = tangentX * normalY - tangentY * normalX;
    const ringShare = ring / Math.max(1, ringCount - 1);
    for (let around = 0; around <= radialSegments; around += 1) {
      const sine = sines[around] ?? 0;
      const cosine = cosines[around] ?? 0;
      let radialX = cosine * normalX + sine * binormalX;
      let radialY = cosine * normalY + sine * binormalY;
      let radialZ = cosine * normalZ + sine * binormalZ;
      const radialLength = Math.hypot(radialX, radialY, radialZ) || 1;
      radialX /= radialLength;
      radialY /= radialLength;
      radialZ /= radialLength;
      const vertex = ring * ringSize + around;
      normals[vertex * 3] = radialX;
      normals[vertex * 3 + 1] = radialY;
      normals[vertex * 3 + 2] = radialZ;
      positions[vertex * 3] = point.x + radius * radialX;
      positions[vertex * 3 + 1] = point.y + radius * radialY;
      positions[vertex * 3 + 2] = point.z + radius * radialZ;
      uvs[vertex * 2] = ringShare;
      uvs[vertex * 2 + 1] = around / radialSegments;
    }
  }
  const indices = new Uint32Array(Math.max(0, ringCount - 1) * radialSegments * 6);
  let cursor = 0;
  for (let ring = 1; ring < ringCount; ring += 1) {
    for (let around = 1; around <= radialSegments; around += 1) {
      const behindLeft = ringSize * (ring - 1) + (around - 1);
      const aheadLeft = ringSize * ring + (around - 1);
      const aheadRight = ringSize * ring + around;
      const behindRight = ringSize * (ring - 1) + around;
      indices[cursor] = behindLeft;
      indices[cursor + 1] = aheadLeft;
      indices[cursor + 2] = behindRight;
      indices[cursor + 3] = aheadLeft;
      indices[cursor + 4] = aheadRight;
      indices[cursor + 5] = behindRight;
      cursor += 6;
    }
  }
  return { positions, normals, uvs, indices };
}

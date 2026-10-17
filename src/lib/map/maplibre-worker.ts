// Where the app serves MapLibre's web worker. MapLibre 6 looks for the worker next to its own module,
// which does not exist inside a bundled chunk, so scripts/copy-maplibre-worker.ts copies it here and
// the map code points MapLibre at it with setWorkerUrl.
export const MAPLIBRE_WORKER_PATH = "/vendor/maplibre-gl-worker.mjs";

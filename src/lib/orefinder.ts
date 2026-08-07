// Browser-side ore vein finder.
//
// Runs orefinder.gg's published WebAssembly worldgen model (the same binary the
// orefinder.gg site and the Orekas Meteor addon use) directly in the browser.
// The module is a wasm-bindgen build; the glue below implements the nine host
// functions it imports, using real JS values as externrefs.

type WasmExports = {
  memory: WebAssembly.Memory;
  __wbindgen_externrefs: WebAssembly.Table;
  __wbindgen_malloc: (size: number, align: number) => number;
  __wbindgen_start: () => void;
  world_new: (
    seedLow: number,
    seedHigh: number,
    edition: number,
    version: number,
    biomeSize: number,
    largeBiomes: number,
  ) => number;
  orefinder_new: (world: number, oreType: number) => number;
  zone_new: (x: number, z: number, sizeX: number, sizeZ: number) => number;
  orefinder_find: (finder: number, zone: number) => RawVein[];
};

type RawVein = {
  key: string;
  x: number;
  y: number;
  z: number;
  internalSize: number;
  ores: number;
  confidence: string;
};

export type OreVein = {
  ore: string;
  x: number;
  y: number;
  z: number;
  ores: number;
  size: string;
  confidence: string;
  distance: number;
};

export const ORE_TYPES: Record<string, number> = {
  diamond: 1,
  ancient_debris: 2,
  debris: 2,
  netherite: 2,
  redstone: 3,
  iron: 4,
  emerald: 5,
  gold: 6,
  lapis: 7,
  coal: 8,
  copper: 9,
};

export const ORE_NAMES = [
  "diamond",
  "ancient_debris",
  "redstone",
  "iron",
  "emerald",
  "gold",
  "lapis",
  "coal",
  "copper",
];

// edition: 1 = Java, 2 = Bedrock. version: 10xxyy encoded release.
export const ORE_VERSIONS: Record<string, number> = {
  "1.17": 101700,
  "1.18": 101800,
  "1.19": 101900,
  "1.20": 102000,
  "1.20.2": 102002,
  "1.21": 102100,
  "1.22": 102100,
};

export const ORE_VERSION_NAMES = ["1.21", "1.20.2", "1.20", "1.19", "1.18", "1.17"];

let wasm: WasmExports | null = null;
let loading: Promise<WasmExports> | null = null;

function makeImports(getWasm: () => WasmExports) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const readStr = (ptr: number, len: number) =>
    decoder.decode(new Uint8Array(getWasm().memory.buffer, ptr, len));

  return {
    "./rust_bg.js": {
      __wbg_set_6c60b2e8ad0e9383: (arr: unknown[], i: number, v: unknown) => {
        arr[i] = v;
      },
      __wbg_set_6be42768c690e380: (obj: Record<string, unknown>, k: string, v: unknown) => {
        obj[String(k)] = v;
      },
      __wbg_new_f3c9df4f38f3f798: () => [],
      __wbg_new_4f9fafbb3909af72: () => ({}),
      __wbg___wbindgen_throw_81fc77679af83bc6: (ptr: number, len: number) => {
        throw new Error(readStr(ptr, len));
      },
      __wbg___wbindgen_debug_string_dd5d2d07ce9e6c57: (ret: number, v: unknown) => {
        const w = getWasm();
        const bytes = encoder.encode(String(v));
        const ptr = w.__wbindgen_malloc(bytes.length, 1);
        new Uint8Array(w.memory.buffer).set(bytes, ptr);
        const view = new DataView(w.memory.buffer);
        view.setInt32(ret, ptr, true);
        view.setInt32(ret + 4, bytes.length, true);
      },
      __wbindgen_init_externref_table: () => {
        const table = getWasm().__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
      },
      __wbindgen_cast_0000000000000001: (d: number) => d,
      __wbindgen_cast_0000000000000002: (ptr: number, len: number) => readStr(ptr, len),
    },
  };
}

async function loadWasm(): Promise<WasmExports> {
  if (wasm) return wasm;
  if (!loading) {
    loading = (async () => {
      const imports = makeImports(() => wasm as WasmExports);
      const source = fetch("/wasm/orefinder.wasm");
      const { instance } = await WebAssembly.instantiateStreaming(source, imports).catch(
        async () => {
          const bytes = await (await fetch("/wasm/orefinder.wasm")).arrayBuffer();
          return WebAssembly.instantiate(bytes, imports);
        },
      );
      wasm = instance.exports as unknown as WasmExports;
      wasm.__wbindgen_start();
      return wasm;
    })();
  }
  return loading;
}

function sizeFromKey(key: string): string {
  const head = key.split("/")[0] ?? "";
  return head || "vein";
}

export type OreSearchParams = {
  seed: string;
  ore: string;
  x: number;
  /** Optional player Y. When given, distances are true 3D distances. */
  y?: number;
  z: number;
  chunkRadius: number;
  version: string;
  edition?: number;
};

export async function findOres(params: OreSearchParams): Promise<OreVein[]> {
  const oreId = ORE_TYPES[params.ore.toLowerCase()];
  if (!oreId) throw new Error(`Unknown ore "${params.ore}". Try: ${ORE_NAMES.join(", ")}`);

  const versionId = ORE_VERSIONS[params.version];
  if (!versionId)
    throw new Error(
      `Unknown version "${params.version}". Try: ${ORE_VERSION_NAMES.join(", ")}`,
    );

  let seed: bigint;
  try {
    seed = BigInt(params.seed.trim());
  } catch {
    throw new Error(`Seed must be a whole number, got "${params.seed}"`);
  }

  const w = await loadWasm();
  const low = Number(BigInt.asIntN(32, seed & 0xffffffffn));
  const high = Number(BigInt.asIntN(32, BigInt.asIntN(64, seed) >> 32n));

  const world = w.world_new(low, high, params.edition ?? 1, versionId, NaN, 0);
  const finder = w.orefinder_new(world, oreId);
  const r = Math.max(0, Math.min(24, params.chunkRadius));
  const zone = w.zone_new(
    (params.x >> 4) - r,
    (params.z >> 4) - r,
    r * 2 + 1,
    r * 2 + 1,
  );

  const raw = w.orefinder_find(finder, zone) ?? [];
  const label = params.ore.toLowerCase();

  const hasY = Number.isFinite(params.y as number);

  return raw
    .map((v) => ({
      ore: label,
      x: v.x,
      y: v.y,
      z: v.z,
      ores: v.ores,
      size: sizeFromKey(v.key),
      confidence: v.confidence,
      distance: hasY
        ? Math.hypot(v.x - params.x, v.y - (params.y as number), v.z - params.z)
        : Math.hypot(v.x - params.x, v.z - params.z),
    }))
    .sort((a, b) => a.distance - b.distance);
}

/* ------------------------------------------------------------------ */
/* Branch grouping                                                     */
/* ------------------------------------------------------------------ */

export type OreBranch = {
  /** Veins in walk order: closest to the player first, then nearest-to-previous. */
  veins: OreVein[];
  /** Distance from the player to the first vein of the branch. */
  startDistance: number;
  /** Total path length walking the branch in order. */
  pathLength: number;
  /** Total ore blocks across the branch. */
  ores: number;
};

function dist(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  useY: boolean,
) {
  return useY
    ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
    : Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * Groups veins into "branches": chains built by repeatedly hopping to the
 * nearest unvisited vein. A hop longer than `breakDistance` ends the branch,
 * so each branch is a tight cluster you can mine in one trip instead of a flat
 * list that ping-pongs across the world at equal radius.
 */
export function buildBranches(
  veins: OreVein[],
  origin: { x: number; y?: number; z: number },
  opts: { breakDistance?: number; maxVeins?: number } = {},
): OreBranch[] {
  const breakDistance = opts.breakDistance ?? 48;
  const maxVeins = opts.maxVeins ?? 40;
  const useY = Number.isFinite(origin.y as number);
  const start = { x: origin.x, y: (origin.y as number) ?? 0, z: origin.z };

  const pool = veins.slice(0, maxVeins);
  const used = new Array(pool.length).fill(false);
  const branches: OreBranch[] = [];
  let remaining = pool.length;

  while (remaining > 0) {
    // Seed the branch with the unvisited vein closest to the player.
    let seedIdx = -1;
    let seedDist = Infinity;
    for (let i = 0; i < pool.length; i++) {
      if (used[i]) continue;
      const d = pool[i]!.distance;
      if (d < seedDist) {
        seedDist = d;
        seedIdx = i;
      }
    }
    if (seedIdx < 0) break;

    used[seedIdx] = true;
    remaining--;
    const chain: OreVein[] = [pool[seedIdx]!];
    let pathLength = 0;
    let tip = pool[seedIdx]!;

    // Walk nearest-neighbour until the next hop is too far.
    for (;;) {
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < pool.length; i++) {
        if (used[i]) continue;
        const d = dist(tip, pool[i]!, useY);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      if (bestIdx < 0 || bestDist > breakDistance) break;
      used[bestIdx] = true;
      remaining--;
      pathLength += bestDist;
      tip = pool[bestIdx]!;
      chain.push(tip);
    }

    branches.push({
      veins: chain,
      startDistance: dist(start, chain[0]!, useY),
      pathLength,
      ores: chain.reduce((s, v) => s + v.ores, 0),
    });
  }

  return branches.sort((a, b) => a.startDistance - b.startDistance);
}

export const ORE_HELP = `  ore <seed> <ore> <x> [y] <z> [chunk-radius] [version]

Ores:    ${ORE_NAMES.join(", ")}
Versions: ${ORE_VERSION_NAMES.join(", ")}

Give your Y coordinate for true 3D distances (recommended).
Results are grouped into branches: each branch is a cluster you can mine in
one trip, ordered closest-to-you first then nearest-to-previous vein.

Examples:
  ore 12345 diamond 0 0
  ore 12345 diamond 120 -54 -300
  ore 12345 ancient_debris 250 12 -400 8 1.21`;

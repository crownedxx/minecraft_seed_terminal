// Browser-side runner for the cubiomes seed_finder program, compiled to
// WebAssembly. Mirrors what web/server.js did by spawning the native binary.

type EmscriptenFactory = (opts: {
  noInitialRun?: boolean;
  print?: (s: string) => void;
  printErr?: (s: string) => void;
}) => Promise<{ callMain: (args: string[]) => number }>;

let factoryPromise: Promise<EmscriptenFactory> | null = null;

function loadFactory(): Promise<EmscriptenFactory> {
  if (!factoryPromise) {
    factoryPromise = import("./seedfinder-wasm.mjs").then(
      (m) => (m as unknown as { default: EmscriptenFactory }).default,
    );
  }
  return factoryPromise;
}

export async function runSeedFinder(args: string[]): Promise<string> {
  const factory = await loadFactory();
  const lines: string[] = [];
  const mod = await factory({
    noInitialRun: true,
    print: (s) => lines.push(s),
    printErr: (s) => lines.push(s),
  });
  try {
    mod.callMain(args);
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    if (!/exit/i.test(msg)) lines.push(`Error: ${msg}`);
  }
  return lines.join("\n");
}

export function parseListOutput(output: string, section: string): string[] {
  const lines = output.split("\n");
  const startIdx = lines.findIndex((l) => l.includes(section));
  if (startIdx === -1) return [];
  const items: string[] = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (!line || line.startsWith("Versions:") || line.startsWith("Examples:")) break;
    line.split(/\s{2,}/).forEach((item) => {
      const trimmed = item.trim();
      if (trimmed) items.push(trimmed);
    });
  }
  return items;
}

export type ClosestMatch = {
  x: number;
  z: number;
  distance?: number;
  chunk?: { x: number; z: number };
};

export function parseSearchOutput(output: string): { closest: ClosestMatch | null } {
  const result: { closest: ClosestMatch | null } = { closest: null };
  let inClosest = false;
  for (const line of output.split("\n")) {
    if (line.includes("CLOSEST MATCH")) {
      inClosest = true;
      continue;
    }
    if (line.includes("ALL MATCHES")) {
      inClosest = false;
      continue;
    }
    if (!inClosest) continue;
    const pos = line.match(/Position:\s*\((-?\d+),\s*(-?\d+)\)/);
    if (pos) result.closest = { x: Number(pos[1]), z: Number(pos[2]) };
    const dist = line.match(/Distance:\s*([\d.]+)/);
    if (dist && result.closest) result.closest.distance = Number(dist[1]);
    const chunk = line.match(/Chunk:\s*\((-?\d+),\s*(-?\d+)\)/);
    if (chunk && result.closest)
      result.closest.chunk = { x: Number(chunk[1]), z: Number(chunk[2]) };
  }
  return result;
}

export const HELP_TEXT = `Available commands:

  help                       Show this help
  biomes                     List all available biomes
  structures                 List all available structures
  search <seed> <biome|structure> <name> <x> <z> [radius] [version]
  clear                      Clear the terminal

Examples:
  search 12345 biome mushroom_fields 0 0 1000
  search 12345 structure village 100 200 5000 1.20
`;

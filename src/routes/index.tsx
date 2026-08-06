import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ORE_HELP,
  ORE_NAMES,
  ORE_VERSION_NAMES,
  findOres,
} from "@/lib/orefinder";
import {
  HELP_TEXT,
  parseListOutput,
  parseSearchOutput,
  runSeedFinder,
} from "@/lib/seedfinder";


export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Minecraft Seed Finder — Biome & Structure Locator" },
      {
        name: "description",
        content:
          "Terminal-style Minecraft seed finder. Locate the closest biome or structure to any coordinates for versions 1.18 through 1.21, powered by cubiomes in WebAssembly.",
      },
      { property: "og:title", content: "Minecraft Seed Finder — Biome & Structure Locator" },
      {
        property: "og:description",
        content:
          "Find the nearest biome or structure in any Minecraft seed, right in your browser.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SeedFinderPage,
});

type LineType = "text" | "success" | "error" | "info" | "header" | "dim";
type Line = { id: number; type: LineType; text: string };

const CLASS_FOR: Record<LineType, string> = {
  text: "sf-text",
  success: "sf-success",
  error: "sf-error",
  info: "sf-info",
  header: "sf-header-line",
  dim: "sf-dim",
};

const VERSIONS = ["1.21", "1.20", "1.19", "1.18"];

function SeedFinderPage() {
  const [lines, setLines] = useState<Line[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [command, setCommand] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [biomes, setBiomes] = useState<string[]>([]);
  const [structures, setStructures] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [formOpen, setFormOpen] = useState(false);


  const [seed, setSeed] = useState("12345");
  const [type, setType] = useState("biome");
  const [version, setVersion] = useState("1.21");
  const [name, setName] = useState("plains");
  const [x, setX] = useState("0");
  const [z, setZ] = useState("0");
  const [radius, setRadius] = useState("500");

  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lineId = useRef(0);

  const append = useCallback((type: LineType, text: string) => {
    setLines((prev) => [...prev, { id: lineId.current++, type, text }]);
  }, []);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [lines, busy]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      append("info", "Booting seed finder engine (WebAssembly)…");
      try {
        const [b, s] = await Promise.all([
          runSeedFinder(["--list-biomes"]),
          runSeedFinder(["--list-structures"]),
        ]);
        if (cancelled) return;
        setBiomes(parseListOutput(b, "Biomes:"));
        setStructures(parseListOutput(s, "Structures:"));
        setReady(true);
        append("system" as LineType, "");
        append("success", "Engine ready — running locally in your browser.");
        append("info", 'Type "help" for commands or use the sidebar form.');
      } catch (e) {
        if (!cancelled) append("error", `Failed to load engine: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [append]);

  const search = useCallback(
    async (args: string[]) => {
      setBusy(true);
      try {
        const output = await runSeedFinder(args);
        for (const raw of output.split("\n")) {
          if (!raw.trim()) continue;
          let t: LineType = "text";
          if (raw.includes("CLOSEST MATCH") || raw.includes("ALL MATCHES")) t = "header";
          else if (/error/i.test(raw)) t = "error";
          else if (raw.includes("Searching")) t = "info";
          append(t, raw);
        }
        const parsed = parseSearchOutput(output);
        if (parsed.closest) {
          append(
            "success",
            `Closest match: (${parsed.closest.x}, ${parsed.closest.z}) — Distance: ${parsed.closest.distance?.toFixed(1)} blocks`,
          );
        }
      } catch (e) {
        append("error", `Error: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [append],
  );

  const oreSearch = useCallback(
    async (args: string[]) => {
      const [oreSeed, oreName, oreX, oreZ, oreRadius, oreVersion] = args;
      setBusy(true);
      try {
        const cx = Number(oreX);
        const cz = Number(oreZ);
        if (!Number.isFinite(cx) || !Number.isFinite(cz))
          throw new Error("X and Z must be numbers");
        const chunkRadius = oreRadius ? Number(oreRadius) : 4;
        if (!Number.isFinite(chunkRadius) || chunkRadius < 0)
          throw new Error("Chunk radius must be a positive number");

        append(
          "info",
          `Simulating ${oreName} veins for seed ${oreSeed} around (${cx}, ${cz}) — ${chunkRadius * 2 + 1}x${chunkRadius * 2 + 1} chunks…`,
        );

        const veins = await findOres({
          seed: oreSeed ?? "",
          ore: oreName ?? "",
          x: cx,
          z: cz,
          chunkRadius,
          version: oreVersion ?? "1.21",
        });

        if (veins.length === 0) {
          append("error", "No veins found in that area. Try a larger chunk radius.");
          return;
        }

        const first = veins[0]!;
        append("header", "CLOSEST VEIN");
        append("success", `  Position: (${first.x}, ${first.y}, ${first.z})`);
        append("text", `  Blocks:   ${first.ores}  (${first.size} vein)`);
        append("text", `  Chunk:    (${first.x >> 4}, ${first.z >> 4})`);
        append("text", `  Distance: ${first.distance.toFixed(1)} blocks`);

        append("header", `ALL VEINS (${veins.length} found — showing nearest 25)`);
        for (const v of veins.slice(0, 25)) {
          append(
            "text",
            `  (${String(v.x).padStart(6)}, ${String(v.y).padStart(4)}, ${String(v.z).padStart(6)})  ` +
              `${String(v.ores).padStart(2)} blocks  ${v.size.padEnd(8)} ${v.distance.toFixed(1)}m`,
          );
        }
        const total = veins.reduce((sum, v) => sum + v.ores, 0);
        append("success", `${veins.length} veins / ${total} ore blocks in range.`);
      } catch (e) {
        append("error", `Error: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    [append],
  );

  const processCommand = useCallback(
    (cmd: string) => {
      const parts = cmd.split(/\s+/);
      const head = (parts[0] ?? "").toLowerCase();
      const args = parts.slice(1);
      append("dim", `⬢ seed-finder $ ${cmd}`);

      switch (head) {
        case "help":
          append("info", HELP_TEXT);
          break;
        case "search":
          if (args.length < 5) {
            append("error", "Usage: search <seed> <biome|structure> <name> <x> <z> [radius] [version]");
          } else {
            void search(args);
          }
          break;
        case "ore":
          if (args.length < 4) {
            append("error", "Usage: ore <seed> <ore> <x> <z> [chunk-radius] [version]");
            append("info", ORE_HELP);
          } else {
            void oreSearch(args);
          }
          break;
        case "ores":
          append("header", "Available Ores:");
          append("info", ORE_NAMES.join(", "));
          append("dim", `Versions: ${ORE_VERSION_NAMES.join(", ")}`);
          break;
        case "biomes":
          append("header", "Available Biomes:");
          append("info", biomes.join(", "));
          break;
        case "structures":
          append("header", "Available Structures:");
          append("info", structures.join(", "));
          break;
        case "clear":
          setLines([]);
          break;
        default:
          append("error", `Unknown command: ${head}. Type "help" for commands.`);
      }
    },
    [append, biomes, oreSearch, search, structures],
  );


  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const cmd = command.trim();
      setCommand("");
      if (!cmd) return;
      setHistory((h) => [...h, cmd]);
      setHistoryIndex(history.length + 1);
      processCommand(cmd);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (historyIndex > 0) {
        const i = historyIndex - 1;
        setHistoryIndex(i);
        setCommand(history[i] ?? "");
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex < history.length - 1) {
        const i = historyIndex + 1;
        setHistoryIndex(i);
        setCommand(history[i] ?? "");
      } else {
        setHistoryIndex(history.length);
        setCommand("");
      }
    }
  };

  const submitForm = (e: React.FormEvent) => {
    e.preventDefault();
    const args = [seed, type, name, x, z, radius, version];
    append("dim", `⬢ seed-finder $ search ${args.join(" ")}`);
    void search(args);
  };

  const pick = (item: string, category: string) => {
    setSelected(item);
    setType(category);
    setName(item);
  };

  return (
    <div className="sf-root">
      <header className="sf-header">
        <h1>⬢ MINECRAFT SEED FINDER</h1>
        <div className="sf-status">
          <span>{ready ? "Engine ready" : "Loading…"}</span>
          <div className={`sf-dot${ready ? " connected" : ""}`} />
        </div>
        <button
          className="sf-toggle"
          onClick={() => setSidebarHidden((v) => !v)}
          title="Toggle Sidebar"
        >
          ☰ Sidebar
        </button>
      </header>

      <div className="sf-container">
        <div className="sf-layout">
          <div className="sf-terminal">
            <div className="sf-terminal-header">
              <div className="sf-btn-dot" style={{ background: "#ff5f57" }} />
              <div className="sf-btn-dot" style={{ background: "#ffbd2e" }} />
              <div className="sf-btn-dot" style={{ background: "#28ca42" }} />
            </div>
            <div className="sf-output" ref={outputRef} onClick={() => inputRef.current?.focus()}>
              {lines.map((line) => (
                <div key={line.id} className={`sf-line ${CLASS_FOR[line.type] ?? "sf-text"}`}>
                  {line.text}
                </div>
              ))}
              {busy ? <div className="sf-line sf-dim">Searching…</div> : null}
              <div className="sf-line sf-prompt">
                <span className="sf-prefix">⬢</span>
                <span className="sf-prefix">seed-finder</span>
                <span className="sf-prefix">$</span>
                <input
                  ref={inputRef}
                  className="sf-input"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={onKeyDown}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Terminal command input"
                />
              </div>
            </div>
          </div>

          <aside className={`sf-sidebar${sidebarHidden ? " hidden" : ""}`}>
            <div className="sf-section">
              <div className="sf-section-title">Quick Search</div>
              <form className="sf-form" onSubmit={submitForm}>
                <div className="sf-row">
                  <div className="sf-group">
                    <label htmlFor="sf-seed">Seed</label>
                    <input id="sf-seed" value={seed} onChange={(e) => setSeed(e.target.value)} />
                  </div>
                </div>
                <div className="sf-row">
                  <div className="sf-group">
                    <label htmlFor="sf-type">Type</label>
                    <select id="sf-type" value={type} onChange={(e) => setType(e.target.value)}>
                      <option value="biome">Biome</option>
                      <option value="structure">Structure</option>
                    </select>
                  </div>
                  <div className="sf-group">
                    <label htmlFor="sf-version">Version</label>
                    <select
                      id="sf-version"
                      value={version}
                      onChange={(e) => setVersion(e.target.value)}
                    >
                      {VERSIONS.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="sf-row">
                  <div className="sf-group">
                    <label htmlFor="sf-name">Name</label>
                    <input id="sf-name" value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                </div>
                <div className="sf-row">
                  <div className="sf-group">
                    <label htmlFor="sf-x">X</label>
                    <input id="sf-x" type="number" value={x} onChange={(e) => setX(e.target.value)} />
                  </div>
                  <div className="sf-group">
                    <label htmlFor="sf-z">Z</label>
                    <input id="sf-z" type="number" value={z} onChange={(e) => setZ(e.target.value)} />
                  </div>
                </div>
                <div className="sf-row">
                  <div className="sf-group">
                    <label htmlFor="sf-radius">Radius</label>
                    <input
                      id="sf-radius"
                      type="number"
                      min={100}
                      max={5000}
                      value={radius}
                      onChange={(e) => setRadius(e.target.value)}
                    />
                  </div>
                </div>
                <button type="submit" className="sf-btn" disabled={!ready || busy}>
                  {busy ? "Searching…" : "Search"}
                </button>
              </form>
            </div>

            <div className="sf-section">
              <div className="sf-section-title">Biomes</div>
              <ul className="sf-list">
                {biomes.map((b) => (
                  <li
                    key={b}
                    className={selected === b ? "selected" : ""}
                    onClick={() => pick(b, "biome")}
                  >
                    {b}
                  </li>
                ))}
              </ul>
            </div>

            <div className="sf-section">
              <div className="sf-section-title">Structures</div>
              <ul className="sf-list">
                {structures.map((s) => (
                  <li
                    key={s}
                    className={selected === s ? "selected" : ""}
                    onClick={() => pick(s, "structure")}
                  >
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

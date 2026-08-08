import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  ORE_HELP,
  ORE_NAMES,
  ORE_VERSION_NAMES,
  buildBranches,
  findOres,
  type OreBranch,
} from "@/lib/orefinder";
import {
  HELP_TEXT,
  parseAllMatches,
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
  const [sidebarHidden, setSidebarHidden] = useState(true);
  const [formOpen, setFormOpen] = useState(true);
  const [caretPos, setCaretPos] = useState(0);
  const [focused, setFocused] = useState(true);

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
  const lastOreBranches = useRef<{ seed: string; branches: OreBranch[] } | null>(null);
  const lastSearch = useRef<{
    seed: string;
    type: string;
    name: string;
    matches: { id: number; x: number; z: number; distance: number }[];
  } | null>(null);

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
        const matches = parseAllMatches(output);
        const parsed = parseSearchOutput(output);
        if (parsed.closest) {
          lastSearch.current = {
            seed: args[0] ?? "",
            type: args[1] ?? "",
            name: args[2] ?? "",
            matches,
          };
          append(
            "success",
            `Closest match: (${parsed.closest.x}, ${parsed.closest.z}) — Distance: ${parsed.closest.distance?.toFixed(1)} blocks`,
          );
        } else {
          lastSearch.current = null;
        }
        if (!matches.length) {
          append("error", "No matches found in the search area. Try a larger radius.");
        } else {
          append("dim", 'Use "copy <match number>" to copy a match as a /tp teleport command.');
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
      const [oreSeed, oreName, ...rest] = args;
      setBusy(true);
      try {
        // Positional coords: <x> <z> or <x> <y> <z>, then [chunk-radius] [version].
        const nums: number[] = [];
        let i = 0;
        while (
          i < rest.length &&
          rest[i] !== undefined &&
          rest[i] !== "" &&
          Number.isFinite(Number(rest[i]))
        ) {
          nums.push(Number(rest[i]!));
          i++;
        }
        const versionArg = rest[i];

        let cx: number, cz: number, cy: number | undefined, chunkRadius: number;
        if (nums.length === 2) {
          [cx, cz] = [nums[0]!, nums[1]!];
          chunkRadius = 4;
        } else if (nums.length === 3) {
          [cx, cy, cz] = [nums[0]!, nums[1]!, nums[2]!];
          chunkRadius = 4;
        } else if (nums.length >= 4) {
          [cx, cy, cz] = [nums[0]!, nums[1]!, nums[2]!];
          chunkRadius = nums[3]!;
        } else {
          throw new Error("Need at least X and Z coordinates");
        }
        if (!Number.isFinite(chunkRadius) || chunkRadius < 0)
          throw new Error("Chunk radius must be a positive number");

        const where = cy === undefined ? `(${cx}, ${cz})` : `(${cx}, ${cy}, ${cz})`;
        append(
          "info",
          `Simulating ${oreName} veins for seed ${oreSeed} around ${where} — ${chunkRadius * 2 + 1}x${chunkRadius * 2 + 1} chunks…`,
        );

        const veins = await findOres({
          seed: oreSeed ?? "",
          ore: oreName ?? "",
          x: cx,
          y: cy,
          z: cz,
          chunkRadius,
          version: versionArg ?? "1.21",
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
        append(
          "text",
          `  Distance: ${first.distance.toFixed(1)} blocks${cy === undefined ? " (horizontal)" : " (3D)"}` +
            (cy === undefined ? "" : `  ΔY ${first.y - cy > 0 ? "+" : ""}${first.y - cy}`),
        );

        const branches = buildBranches(veins, { x: cx, y: cy, z: cz }, { maxVeins: 40 });
        lastOreBranches.current = { seed: oreSeed ?? "", branches };
        append(
          "header",
          `MINING BRANCHES (${branches.length} clusters from nearest ${Math.min(veins.length, 40)} veins)`,
        );

        branches.forEach((branch, bi) => {
          const head = branch.veins[0]!;
          append(
            "success",
            `  Branch ${bi + 1} — ${branch.veins.length} veins, ${branch.ores} blocks, ` +
              `${branch.startDistance.toFixed(0)}m away, ${branch.pathLength.toFixed(0)}m walk`,
          );
          append("dim", `    entry (${head.x}, ${head.y}, ${head.z})`);
          let prev: (typeof branch.veins)[number] | null = null;
          branch.veins.forEach((v, vi) => {
            const hop =
              prev === null
                ? `${v.distance.toFixed(0)}m from you`
                : `+${Math.hypot(
                    v.x - prev.x,
                    cy === undefined ? 0 : v.y - prev.y,
                    v.z - prev.z,
                  ).toFixed(0)}m`;
            append(
              "text",
              `    #${String(vi + 1).padEnd(2)} (${String(v.x).padStart(6)}, ${String(v.y).padStart(4)}, ${String(v.z).padStart(6)})  ` +
                `${String(v.ores).padStart(2)} blocks  ${v.size.padEnd(8)} ${hop}`,
            );
            prev = v;
          });
        });

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
            append(
              "error",
              "Usage: search <seed> <biome|structure> <name> <x> <z> [radius] [version]",
            );
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
        case "copy": {
          const branchIdx = args.indexOf("branch");
          const numberIdx = args.indexOf("number");
          const branchNum = branchIdx !== -1 ? Number(args[branchIdx + 1]) : NaN;
          const veinNum = numberIdx !== -1 ? Number(args[numberIdx + 1]) : NaN;

          const hasBranchArgs = branchIdx !== -1 && numberIdx !== -1;

          if (hasBranchArgs) {
            if (
              !Number.isInteger(branchNum) ||
              !Number.isInteger(veinNum) ||
              branchNum < 1 ||
              veinNum < 1
            ) {
              append("error", "Usage: copy branch <branch> number <vein>");
              append(
                "info",
                "Copies the coordinates of a vein from the last ore search as a /tp command.",
              );
              break;
            }
            if (!lastOreBranches.current) {
              append(
                "error",
                'No ore branches to copy from. Run "ore <seed> <ore> <x> <z>" first.',
              );
              break;
            }
            const branch = lastOreBranches.current.branches[branchNum - 1];
            if (!branch) {
              append(
                "error",
                `Branch ${branchNum} not found. The last ore run had ${lastOreBranches.current.branches.length} branch${lastOreBranches.current.branches.length === 1 ? "" : "es"}.`,
              );
              break;
            }
            const vein = branch.veins[veinNum - 1];
            if (!vein) {
              append(
                "error",
                `Number ${veinNum} not found in branch ${branchNum}. That branch has ${branch.veins.length} vein${branch.veins.length === 1 ? "" : "s"}.`,
              );
              break;
            }
            const tp = `/tp ${vein.x} ${vein.y} ${vein.z}`;
            append("text", `Branch ${branchNum}, number ${veinNum} → ${tp}`);
            void navigator.clipboard
              .writeText(tp)
              .then(() => append("success", "Copied to clipboard."))
              .catch(() => append("error", "Failed to copy to clipboard."));
            break;
          }

          const s = lastSearch.current;
          if (!s) {
            append(
              "error",
              'Nothing to copy. Run "search <seed> <biome|structure> <name> <x> <z>" or an "ore" search first.',
            );
            break;
          }
          if (!s.matches.length) {
            append(
              "error",
              "No search matches recorded. Run a search that finds at least one match.",
            );
            break;
          }
          let match = s.matches[0]!;
          const matchArg = args.length && args[0] === "number" ? args[1] : args[0];
          if (matchArg !== undefined && matchArg !== "") {
            const numArg = Number(matchArg);
            if (!Number.isInteger(numArg) || numArg < 1) {
              append("error", "Usage: copy [number] <match number> — copies a match as /tp.");
              break;
            }
            const candidate = s.matches[numArg - 1];
            if (!candidate) {
              append(
                "error",
                `Match ${numArg} not found. The last search found ${s.matches.length} match${s.matches.length === 1 ? "" : "es"}.`,
              );
              break;
            }
            match = candidate;
          }
          const stp = `/tp ${match.x} ${match.z}`;
          append("text", `${s.name} (${s.type}) #${match.id} → ${stp}`);
          void navigator.clipboard
            .writeText(stp)
            .then(() => append("success", "Copied to clipboard."))
            .catch(() => append("error", "Failed to copy to clipboard."));
          break;
        }
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
                <span className="sf-input-wrap">
                  <input
                    ref={inputRef}
                    className="sf-input"
                    value={command}
                    onChange={(e) => {
                      setCommand(e.target.value);
                      setCaretPos(e.target.selectionStart ?? e.target.value.length);
                    }}
                    onKeyDown={onKeyDown}
                    onKeyUp={(e) => setCaretPos(e.currentTarget.selectionStart ?? 0)}
                    onClick={(e) => setCaretPos(e.currentTarget.selectionStart ?? 0)}
                    onSelect={(e) => setCaretPos(e.currentTarget.selectionStart ?? 0)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Terminal command input"
                  />
                  <span
                    className={`sf-caret${focused ? " blink" : " idle"}`}
                    style={{ left: `${caretPos}ch` }}
                    aria-hidden="true"
                  />
                </span>
              </div>
            </div>
          </div>

          <aside className={`sf-sidebar${sidebarHidden ? " hidden" : ""}`}>
            <div className="sf-section">
              <button
                type="button"
                className="sf-collapse-trigger"
                aria-expanded={formOpen}
                aria-controls="sf-quick-search"
                onClick={() => setFormOpen((v) => !v)}
              >
                <span>Quick Search</span>
                <span className={`sf-chevron${formOpen ? " open" : ""}`}>▾</span>
              </button>
              <form
                id="sf-quick-search"
                className="sf-form"
                onSubmit={submitForm}
                hidden={!formOpen}
              >
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
                    <input
                      id="sf-x"
                      type="number"
                      value={x}
                      onChange={(e) => setX(e.target.value)}
                    />
                  </div>
                  <div className="sf-group">
                    <label htmlFor="sf-z">Z</label>
                    <input
                      id="sf-z"
                      type="number"
                      value={z}
                      onChange={(e) => setZ(e.target.value)}
                    />
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

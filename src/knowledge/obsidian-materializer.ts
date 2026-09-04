import { lstatSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";

import type { VaultRoot, KnowledgeVault } from "./knowledge-vault.js";
import { isCeoActor } from "../operations/actor-identity.js";

export interface ObsidianMaterializationResult {
  readonly directory: string;
  readonly generatedAt: string;
  readonly roots: readonly {
    readonly root: VaultRoot;
    readonly generationId: string | null;
    readonly generationSequence: number | null;
    readonly fileCount: number;
  }[];
  readonly manifestPath: string;
}

export interface ObsidianMaterializer {
  materialize(request: {
    readonly directory: string;
    readonly actorId: string;
    readonly roots?: readonly VaultRoot[];
    readonly generatedAt?: string;
  }): ObsidianMaterializationResult;
}

const defaultRoots: readonly VaultRoot[] = ["CEO"];

function safeDirectory(directory: string): string {
  const trimmed = directory.trim();
  if (!isAbsolute(trimmed)) throw new Error("Obsidian materialization requires an absolute directory.");
  const resolved = resolve(trimmed);
  if (resolved === sep || /^[A-Za-z]:\\?$/u.test(resolved)) throw new Error("Obsidian materialization cannot target a filesystem root.");
  return resolved;
}

function safeRelativePath(path: string): string {
  const normalized = normalize(path);
  if (path.length === 0 || normalized.startsWith("..") || normalized.startsWith(sep) || /^[A-Za-z]:/u.test(normalized)) {
    throw new Error("Obsidian materialization rejected an unsafe vault path.");
  }
  return normalized;
}

export function createObsidianMaterializer(options: {
  readonly vault: KnowledgeVault;
  readonly now?: () => string;
}): ObsidianMaterializer {
  const now = options.now ?? (() => new Date().toISOString());
  return {
    materialize(request) {
      const directory = safeDirectory(request.directory);
      const roots = request.roots === undefined ? defaultRoots : [...new Set(request.roots)];
      if (roots.length === 0) throw new Error("Obsidian materialization requires at least one vault root.");
      if (!isCeoActor(request.actorId)) throw new Error("Only the CEO may materialize the Knowledge Vault for Obsidian.");
      const generatedAt = request.generatedAt ?? now();
      if (!Number.isFinite(Date.parse(generatedAt))) throw new Error("Obsidian materialization requires a valid timestamp.");

      const parent = dirname(directory);
      mkdirSync(parent, { recursive: true });
      const stage = join(parent, `.${directory.split(/[\\/]/u).at(-1) ?? "obsidian"}.staging-${randomUUID()}`);
      mkdirSync(stage, { recursive: true });
      const materializedRoots: {
        readonly root: VaultRoot;
        readonly generationId: string | null;
        readonly generationSequence: number | null;
        readonly fileCount: number;
      }[] = [];
      try {
        for (const root of roots) {
          const generation = options.vault.currentGeneration(root);
          const files = generation === undefined
            ? {}
            : options.vault.readCurrentFiles(root, request.actorId);
          let fileCount = 0;
          for (const [path, content] of Object.entries(files)) {
            const destination = join(stage, root, safeRelativePath(path));
            mkdirSync(dirname(destination), { recursive: true });
            writeFileSync(destination, content, "utf8");
            fileCount += 1;
          }
          materializedRoots.push({
            root,
            generationId: generation?.id ?? null,
            generationSequence: generation?.sequence ?? null,
            fileCount,
          });
        }
        const manifestPath = join(stage, ".real-ming-materialization.json");
        writeFileSync(
          manifestPath,
          `${JSON.stringify({ schema: "real-ming.obsidian.materialization.v1", generatedAt, roots: materializedRoots }, null, 2)}\n`,
          "utf8",
        );
        // A previous export is retained rather than deleted. That gives the
        // CEO a recoverable snapshot if a process is interrupted during swap.
        const previous = `${directory}.previous`;
        try {
          if (lstatSync(directory).isDirectory()) renameSync(directory, previous);
        } catch {
          // The target normally does not exist on first activation.
        }
        renameSync(stage, directory);
        return {
          directory,
          generatedAt,
          roots: materializedRoots,
          manifestPath: join(directory, ".real-ming-materialization.json"),
        };
      } catch (error) {
        // The stage is deliberately left for forensic recovery on failure;
        // no published vault data is removed by this operation.
        throw error;
      }
    },
  };
}

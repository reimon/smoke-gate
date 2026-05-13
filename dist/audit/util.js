"use strict";
/**
 * Utilities compartilhados pelos detectores.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.walkFiles = walkFiles;
exports.readFileSafe = readFileSafe;
exports.hasIgnoreSentinel = hasIgnoreSentinel;
exports.lineOfIndex = lineOfIndex;
exports.extractSnippet = extractSnippet;
exports.relPath = relPath;
exports.applyFileFilter = applyFileFilter;
exports.gitDiffFiles = gitDiffFiles;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Walk recursivo retornando todos os arquivos com extensões aceitas.
 * Pula node_modules, dist, .git, e padrões em `ignore`.
 */
function walkFiles(root, exts, ignore = []) {
    const out = [];
    const defaultIgnore = [
        "node_modules",
        "dist",
        ".git",
        "build",
        "coverage",
        ".next",
        ".turbo",
        ".cache",
        ".claude", // claude code worktrees + skills
        "tmp",
        ".vscode",
        ".idea",
    ];
    const allIgnore = new Set([...defaultIgnore, ...ignore]);
    function recurse(dir) {
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const ent of entries) {
            if (allIgnore.has(ent.name))
                continue;
            const fp = path.join(dir, ent.name);
            if (ent.isDirectory()) {
                recurse(fp);
            }
            else if (ent.isFile() && exts.some((e) => ent.name.endsWith(e))) {
                out.push(fp);
            }
        }
    }
    recurse(root);
    return out;
}
/** Lê arquivo retornando string vazia em erro (evita try/catch repetido). */
function readFileSafe(fp) {
    try {
        return fs.readFileSync(fp, "utf8");
    }
    catch {
        return "";
    }
}
const IGNORE_SENTINEL = "smoke-gate-ignore-file";
/**
 * Arquivo declara `// smoke-gate-ignore-file` no topo? Detectores devem pular.
 * Usado pelos próprios arquivos de detector pra evitar self-match nos padrões
 * de referência (regex, exemplos em comentário), e disponível pra usuários
 * marcarem arquivos legados/gerados.
 */
function hasIgnoreSentinel(source) {
    return source.slice(0, 500).includes(IGNORE_SENTINEL);
}
/** Calcula linha (1-based) de um índice de caractere no source. */
function lineOfIndex(source, idx) {
    let line = 1;
    for (let i = 0; i < idx && i < source.length; i++) {
        if (source[i] === "\n")
            line++;
    }
    return line;
}
/** Extrai N linhas centradas em torno de uma linha (1-based). */
function extractSnippet(source, line, context = 2) {
    const lines = source.split("\n");
    const start = Math.max(0, line - 1 - context);
    const end = Math.min(lines.length, line + context);
    return lines
        .slice(start, end)
        .map((l, i) => {
        const n = start + i + 1;
        const marker = n === line ? ">" : " ";
        return `${marker} ${String(n).padStart(4)} | ${l}`;
    })
        .join("\n");
}
/** Caminho relativo ao root (útil pra report). */
function relPath(root, abs) {
    return path.relative(root, abs);
}
/**
 * Filtra lista de arquivos absolutos por uma whitelist relativa ao root.
 * Se filter for undefined, retorna a lista intacta.
 */
function applyFileFilter(files, root, filter) {
    if (!filter)
        return files;
    return files.filter((f) => filter.has(path.relative(root, f)));
}
/**
 * Roda `git diff --name-only <base>...HEAD` e devolve a lista de arquivos
 * modificados (relativos ao root do repo). Retorna [] se git falhar.
 *
 * `base` pode ser: "main", "origin/main", "HEAD~5", commit SHA, etc.
 */
function gitDiffFiles(root, base) {
    const child = require("child_process");
    try {
        const out = child.execSync(`git -C "${root}" diff --name-only ${base}...HEAD`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
        return out
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean);
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=util.js.map
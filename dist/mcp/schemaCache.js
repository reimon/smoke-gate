"use strict";
/**
 * Cache de schema em memória para MCP server.
 *
 * Por que existe: a CLI re-parsa migrations a cada invocação (lento, ~5s
 * em projetos grandes). MCP server roda como processo persistente — então
 * vale carregar 1x e reusar. Permite o caso `audit_check_sql` responder
 * em < 50ms, o que é o killer feature pra prevenção em tempo real.
 *
 * Invalidação: o cache tem um mtime do diretório de migrations. Se alguém
 * adiciona uma nova migration sem reiniciar o server, a próxima chamada
 * detecta o mtime maior e recarrega.
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
exports.getSchema = getSchema;
exports.invalidateSchema = invalidateSchema;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const util_1 = require("../audit/util");
const cache = new Map();
/**
 * Carrega (ou retorna do cache) o schema pro projeto. `projectRoot` é
 * usado como chave; mudou de projeto, novo cache.
 */
function getSchema(projectRoot) {
    const entry = cache.get(projectRoot);
    const sig = computeSignature(projectRoot);
    if (entry && entry.signature === sig.signature) {
        return entry.schema;
    }
    const fresh = loadSchemaFromDisk(sig.roots);
    cache.set(projectRoot, {
        schema: fresh,
        signature: sig.signature,
        roots: sig.roots,
    });
    return fresh;
}
/** Força reload no próximo `getSchema`. */
function invalidateSchema(projectRoot) {
    cache.delete(projectRoot);
}
function computeSignature(projectRoot) {
    const roots = collectSqlRoots(projectRoot);
    let maxMtime = 0;
    for (const root of roots) {
        const files = (0, util_1.walkFiles)(root, [".sql"], []);
        for (const fp of files) {
            try {
                const m = fs.statSync(fp).mtimeMs;
                if (m > maxMtime)
                    maxMtime = m;
            }
            catch {
                // arquivo removido entre walk e stat, ignora
            }
        }
    }
    return { signature: maxMtime, roots };
}
function collectSqlRoots(projectRoot) {
    const candidates = [
        path.join(projectRoot, "api", "migrations"),
        path.join(projectRoot, "api"),
        path.join(projectRoot, "migrations"),
        path.join(projectRoot, "db", "migrations"),
        path.join(projectRoot, "db"),
    ];
    const found = [];
    for (const c of candidates) {
        if (fs.existsSync(c) && fs.statSync(c).isDirectory())
            found.push(c);
    }
    return found;
}
// ── Schema parsing (compartilhado com sqlDrift detector) ─────────────────
// Repetido aqui pra desacoplar o cache do detector. Próxima refatoração:
// extrair pra src/audit/schemaParser.ts e ambos importam.
const CREATE_TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?(\w+)["']?\s*\(/gi;
const ALTER_TABLE_RE = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?["']?(\w+)["']?\s+([\s\S]*?);/gi;
const ADD_COLUMN_RE = /ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?["']?(\w+)["']?/gi;
function loadSchemaFromDisk(roots) {
    const schema = new Map();
    for (const root of roots) {
        const files = (0, util_1.walkFiles)(root, [".sql"], []);
        for (const fp of files) {
            const sql = stripSqlComments((0, util_1.readFileSafe)(fp));
            parseCreateTables(sql, schema);
            parseAlterTables(sql, schema);
        }
    }
    return schema;
}
function stripSqlComments(sql) {
    return sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
function parseCreateTables(sql, schema) {
    let m;
    while ((m = CREATE_TABLE_RE.exec(sql)) !== null) {
        const table = m[1].toLowerCase();
        const bodyStart = m.index + m[0].length;
        const body = extractBalancedParens(sql, bodyStart);
        if (body === null)
            continue;
        if (!schema.has(table))
            schema.set(table, new Set());
        const cols = schema.get(table);
        for (const colName of extractColumnsFromBody(body)) {
            cols.add(colName.toLowerCase());
        }
    }
}
function parseAlterTables(sql, schema) {
    let outer;
    while ((outer = ALTER_TABLE_RE.exec(sql)) !== null) {
        const table = outer[1].toLowerCase();
        const body = outer[2];
        ADD_COLUMN_RE.lastIndex = 0;
        let inner;
        while ((inner = ADD_COLUMN_RE.exec(body)) !== null) {
            const col = inner[1].toLowerCase();
            if (["constraint", "primary", "foreign", "unique", "check", "exclude"].includes(col))
                continue;
            if (!schema.has(table))
                schema.set(table, new Set());
            schema.get(table).add(col);
        }
    }
}
function extractBalancedParens(s, start) {
    let depth = 1;
    let inSingle = false;
    for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (c === "'" && s[i - 1] !== "\\")
            inSingle = !inSingle;
        if (inSingle)
            continue;
        if (c === "(")
            depth++;
        else if (c === ")") {
            depth--;
            if (depth === 0)
                return s.slice(start, i);
        }
    }
    return null;
}
function extractColumnsFromBody(body) {
    const out = [];
    const parts = splitTopLevel(body, ",");
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed)
            continue;
        if (/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE)\b/i.test(trimmed))
            continue;
        const colMatch = trimmed.match(/^["']?(\w+)["']?\s+/);
        if (colMatch)
            out.push(colMatch[1]);
    }
    return out;
}
function splitTopLevel(s, sep) {
    const out = [];
    let depth = 0;
    let buf = "";
    for (const ch of s) {
        if (ch === "(")
            depth++;
        else if (ch === ")")
            depth--;
        if (ch === sep && depth === 0) {
            out.push(buf);
            buf = "";
        }
        else {
            buf += ch;
        }
    }
    if (buf)
        out.push(buf);
    return out;
}
//# sourceMappingURL=schemaCache.js.map
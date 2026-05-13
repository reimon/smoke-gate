/**
 * smoke-gate MCP server (v0.3)
 *
 * Stdio. Exposes tools any MCP-aware agent (Claude Code, Cursor, Cline,
 * Continue, Zed, Windsurf) can call.
 *
 * Tools:
 *   audit_run         full audit, returns findings
 *   audit_check_sql   validate a single SQL string against the schema
 *   schema_lookup     list columns of a given table
 *   audit_explain     deep-dive context for a finding
 *   audit_apply_fix   produce a patch (dryRun=true by default)
 *
 * The point: cache schema once, answer queries in <50ms. Lets the agent
 * call `audit_check_sql` BEFORE writing SQL — prevention, not detection.
 */
export declare function startMcpServer(): Promise<void>;
//# sourceMappingURL=server.d.ts.map
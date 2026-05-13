"use strict";
/**
 * @kaiketsu/smoke-gate/express — driver baseado em supertest.
 *
 * Funciona com qualquer app Express (ou compatível: Express 4, 5, Connect).
 * Mede latência via Date.now() em volta do request.
 *
 * supertest é peer dep — instale junto: `npm i -D supertest`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.supertestDriver = supertestDriver;
/**
 * Cria um driver que dispara requests contra um app Express via supertest.
 *
 * @example
 *   import { supertestDriver } from "@kaiketsu/smoke-gate/express";
 *   const driver = supertestDriver(app);
 */
function supertestDriver(app) {
    // require dinâmico — permite que consumidores que não usam o adapter
    // não precisem de supertest instalado.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const request = require("supertest");
    return {
        async request(ep) {
            const agent = request(app);
            const method = ep.method.toLowerCase();
            let req = agent[method](ep.path);
            if (ep.headers) {
                for (const [k, v] of Object.entries(ep.headers)) {
                    req = req.set(k, v);
                }
            }
            const startedAt = Date.now();
            const res = ep.body !== undefined && method !== "get"
                ? await req.send(ep.body)
                : await req;
            const durationMs = Date.now() - startedAt;
            return {
                status: res.status,
                body: res.body,
                headers: res.headers,
                durationMs,
            };
        },
    };
}
//# sourceMappingURL=express.js.map
/**
 * @kaiketsu/smoke-gate/express — driver baseado em supertest.
 *
 * Funciona com qualquer app Express (ou compatível: Express 4, 5, Connect,
 * Koa via wrapper). Mede latência via Date.now() em volta do request.
 */
/**
 * Cria um driver que dispara requests contra um app Express via supertest.
 *
 * @example
 *   import { supertestDriver } from "@kaiketsu/smoke-gate/express";
 *   const driver = await supertestDriver(app);
 */
export async function supertestDriver(app) {
    // Lazy import — supertest é peer dep opcional.
    const { default: request } = (await import("supertest"));
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
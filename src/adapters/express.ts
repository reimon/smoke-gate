/**
 * @kaiketsu/smoke-gate/express — driver baseado em supertest.
 *
 * Funciona com qualquer app Express (ou compatível: Express 4, 5, Connect).
 * Mede latência via Date.now() em volta do request.
 *
 * supertest é peer dep — instale junto: `npm i -D supertest`.
 */

import type { SmokeDriver, SmokeEndpoint, SmokeResponse } from "../core";

/** Tipo opaco do app Express (evita peer dep de @types/express). */
export type ExpressLike = unknown;

/**
 * Cria um driver que dispara requests contra um app Express via supertest.
 *
 * @example
 *   import { supertestDriver } from "@kaiketsu/smoke-gate/express";
 *   const driver = supertestDriver(app);
 */
export function supertestDriver(app: ExpressLike): SmokeDriver {
  // require dinâmico — permite que consumidores que não usam o adapter
  // não precisem de supertest instalado.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const request = require("supertest") as (app: unknown) => SupertestAgent;

  return {
    async request(ep: SmokeEndpoint & { path: string }): Promise<SmokeResponse> {
      const agent = request(app);
      const method = ep.method.toLowerCase() as
        | "get"
        | "post"
        | "put"
        | "patch"
        | "delete";

      let req: SupertestRequest = agent[method](ep.path);
      if (ep.headers) {
        for (const [k, v] of Object.entries(ep.headers)) {
          req = req.set(k, v);
        }
      }

      const startedAt = Date.now();
      const res: SupertestResponse =
        ep.body !== undefined && method !== "get"
          ? await req.send(ep.body as object)
          : await (req as unknown as Promise<SupertestResponse>);
      const durationMs = Date.now() - startedAt;

      return {
        status: res.status,
        body: res.body,
        headers: res.headers as Record<string, string>,
        durationMs,
      };
    },
  };
}

// ── Tipos mínimos de supertest pra não exigir @types/supertest no build ────
interface SupertestRequest {
  set(field: string, value: string): SupertestRequest;
  send(body: object): Promise<SupertestResponse>;
  then<T>(onFulfilled: (res: SupertestResponse) => T): Promise<T>;
}
interface SupertestResponse {
  status: number;
  body: unknown;
  headers: Record<string, string | string[]>;
}
interface SupertestAgent {
  get(url: string): SupertestRequest & Promise<SupertestResponse>;
  post(url: string): SupertestRequest & Promise<SupertestResponse>;
  put(url: string): SupertestRequest & Promise<SupertestResponse>;
  patch(url: string): SupertestRequest & Promise<SupertestResponse>;
  delete(url: string): SupertestRequest & Promise<SupertestResponse>;
}

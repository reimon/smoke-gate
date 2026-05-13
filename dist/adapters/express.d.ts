/**
 * @kaiketsu/smoke-gate/express — driver baseado em supertest.
 *
 * Funciona com qualquer app Express (ou compatível: Express 4, 5, Connect).
 * Mede latência via Date.now() em volta do request.
 *
 * supertest é peer dep — instale junto: `npm i -D supertest`.
 */
import type { SmokeDriver } from "../core";
/** Tipo opaco do app Express (evita peer dep de @types/express). */
export type ExpressLike = unknown;
/**
 * Cria um driver que dispara requests contra um app Express via supertest.
 *
 * @example
 *   import { supertestDriver } from "@kaiketsu/smoke-gate/express";
 *   const driver = supertestDriver(app);
 */
export declare function supertestDriver(app: ExpressLike): SmokeDriver;
//# sourceMappingURL=express.d.ts.map
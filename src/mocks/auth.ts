/**
 * @kaiketsu/smoke-gate/mocks — utilitários pra mockar middlewares de auth.
 *
 * Não acopla a vitest/jest — retorna funções puras que o consumidor passa
 * pro test runner.
 */

/**
 * Constrói um middleware Express que injeta um usuário fake em `req.user`.
 * Use com `vi.mock("../middleware/auth", ...)` ou monte direto no app de
 * teste antes do router.
 *
 * @example
 *   import { fakeAuth } from "@kaiketsu/smoke-gate/mocks";
 *   const app = express();
 *   app.use(fakeAuth({ id: TEST_USER_ID, role: "aluno" }));
 *   app.use("/career-intelligence", router);
 */
export interface FakeUser {
  id: string;
  email?: string;
  role?: string;
  roles?: string[];
  [key: string]: unknown;
}

export type FakeAuthMiddleware = (
  req: { user?: FakeUser },
  _res: unknown,
  next: () => void,
) => void;

export function fakeAuth(user: FakeUser): FakeAuthMiddleware {
  const filled: FakeUser = {
    email: `${user.id}@smoke.test`,
    role: "aluno",
    roles: [user.role ?? "aluno"],
    ...user,
  };
  return (req, _res, next) => {
    req.user = filled;
    next();
  };
}

/**
 * Versão pra usar com `vi.mock()` — retorna um módulo-shape que substitui
 * o middleware `requireAuth` por um pass-through que injeta o user.
 *
 * @example
 *   vi.mock("../middleware/auth", () => fakeAuthModule({ id: TEST_USER_ID }));
 */
export function fakeAuthModule(user: FakeUser): {
  requireAuth: FakeAuthMiddleware;
} {
  return { requireAuth: fakeAuth(user) };
}

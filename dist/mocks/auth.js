/**
 * @kaiketsu/smoke-gate/mocks — utilitários pra mockar middlewares de auth.
 *
 * Não acopla a vitest/jest — retorna funções puras que o consumidor passa
 * pro test runner.
 */
export function fakeAuth(user) {
    const filled = {
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
export function fakeAuthModule(user) {
    return { requireAuth: fakeAuth(user) };
}
//# sourceMappingURL=auth.js.map
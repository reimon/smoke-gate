# Custom detectors

Crie `smoke-gate.config.{ts,js,mjs,cjs}` no root do projeto. Cada empresa registra detectores próprios — multiplica adoção sem precisar commitar nada no framework.

```ts
import { defineConfig, type Detector } from "@kaiketsu/smoke-gate";

const auditLogRequired: Detector = {
  name: "auditLogRequired",
  async run(ctx) {
    // encontra rotas /admin/* sem auditLog()
    return findings;
  },
};

export default defineConfig({
  detectors: [auditLogRequired],
  disable: ["smokeCoverage"],          // desliga built-in que não importa
  severityOverrides: { "AUTH-001": "warning" },
  ignore: ["legacy/**"],
});
```

Para `.ts` sem build, instale `tsx`: `npm i -D tsx`. Ou compile pra `.js`.

Exemplo completo com 2 detectores reais (`adminAuditLogRequired`, `crossFeatureImports`) em [`examples/custom-detectors/smoke-gate.config.ts`](../examples/custom-detectors/smoke-gate.config.ts).

import { defineConfig } from "vitest/config";

/**
 * esbuild (vitest's transformer) does not read `emitDecoratorMetadata` and does
 * not need to: these tests construct Nest providers directly rather than through
 * the DI container, so no design-time type metadata is required. It does need
 * `experimentalDecorators` to accept `@Injectable()` and `@Inject()`.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.spec.ts"],
  },
  esbuild: {
    target: "es2022",
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false,
      },
    },
  },
});

import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

// Load `.sql` imports as default-export strings — mirrors the Worker build's
// wrangler `rules` Text loader, so modules that import migration SQL (via
// db/migrations-index) work under vitest instead of being parsed as JS.
function sqlAsText() {
  return {
    name: 'sql-as-text',
    enforce: 'pre' as const,
    load(id: string) {
      const path = id.split('?')[0]!;
      if (path.endsWith('.sql')) {
        return `export default ${JSON.stringify(readFileSync(path, 'utf-8'))};`;
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [sqlAsText()],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
  },
});

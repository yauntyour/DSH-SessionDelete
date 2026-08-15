/**
 * tsdown build for dsh-session-delete: the host-half lib is built by tsc
 * (tsconfig.build.json → lib/index.js + lib/types), while the browser client
 * bundle (lib/client.js, CJS closure factory) is built here, replicating the
 * official DSH client-bundle preset:
 * - the artifact registers itself via window.__ModuleLoader__.load({ id, factory })
 *   with the package-name id (client-modules compose keys on the package name;
 *   keep it in sync with package.json "name"),
 * - the client half is pure DOM (no react/xterm/...), so nothing is external:
 *   the whole bundle is self-contained,
 * - no @deepseek-ai/* value imports: cross-plugin collaboration goes through
 *   cordis services (the apply ctx), never value imports.
 */
import type { UserConfig } from 'tsdown'

const config: UserConfig = {
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    'import.meta.resolve': 'undefined',
  },
  inputOptions: {
    resolve: {
      conditionNames: ['browser', 'import', 'require', 'default'],
    },
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-session-delete", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    codeSplitting: false,
  },
}

export default config

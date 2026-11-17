// Tests of the editor's state (stores and the plain functions they use). They run in Node, with the
// network modules mocked, so they need no browser. The tests live in tests/ (outside src/) so the
// build (tsc && vite build) does not see them.
//
// ts-jest only converts the files here (isolatedModules): the types of src/ and tests/ are checked by
// `npx tsc -p tsconfig.test.json`, with the same module resolution the build uses.
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: { module: 'commonjs', target: 'ES2020', esModuleInterop: true, jsx: 'react-jsx', strict: true, skipLibCheck: true, isolatedModules: true },
    }],
  },
};

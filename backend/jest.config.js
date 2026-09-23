module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  setupFiles: ['<rootDir>/test/setup.ts'],
  moduleFileExtensions: ['ts', 'js'],
  testTimeout: 30000,
  moduleNameMapper: {
    // The vendored slot engine is published as ESM (Node loads it through
    // `require(esm)` at runtime). Jest replaces `require`, so the engine is
    // resolved to its TypeScript sources here and transpiled like local code.
    '^@slot-skills/(schema|math|features|runtime|host)$': '<rootDir>/../packages/slot-skills/$1/src/index.ts',
    // ts-jest emits explicit `.js` specifiers for relative imports, which Jest
    // resolves back to the `.ts` file.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};

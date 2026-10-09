// The imported Lucky Lady game vendors its accepted evaluator as an ES module
// (engine.mjs, hash-pinned). Jest can only `require()` an ES module on Node
// 22.21+/24.8+ when its own VM modules API is enabled, so the test script in
// package.json runs the local jest binary with --experimental-vm-modules.
module.exports = { preset: 'ts-jest', testEnvironment: 'node', roots: ['<rootDir>/test'], setupFiles: ['<rootDir>/test/setup.ts'], moduleFileExtensions: ['ts', 'js'], testTimeout: 30000 };

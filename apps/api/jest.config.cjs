/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@vpsy/contracts$': '<rootDir>/../../../packages/contracts/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'CommonJS', moduleResolution: 'Node', esModuleInterop: true } }],
  },
  // @nestjs/throttler's in-memory storage holds internal TTL timers we can't
  // unref from outside the library; force a clean exit once all tests pass so
  // the leaked-handle warning doesn't fail CI with a non-zero exit.
  forceExit: true,
};

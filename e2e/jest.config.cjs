/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  moduleNameMapper: {
    // Strip .js extensions so ts-jest resolves .ts files
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@pokerathome/schema$': '<rootDir>/../schema/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        diagnostics: false,
      },
    ],
  },
};

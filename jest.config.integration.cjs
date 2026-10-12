/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test/integration"],
  testMatch: ["**/*.integration.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.spec.json",
      },
    ],
  },
  // Jest 30 otherwise may pick the compact `agent` reporter and hide PASS lines.
  reporters: ["default"],
  testTimeout: 120_000,
  maxWorkers: 1,
  verbose: true,
};

/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  testMatch: ["**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "/test/integration/", "/test/e2e/", "/test/contract/"],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: "tsconfig.spec.json",
        // diagnostics: { ignoreCodes: [151002] },
      },
    ],
  },
  // Jest 30 otherwise may pick the compact `agent` reporter and hide PASS lines.
  reporters: ["default"],
};

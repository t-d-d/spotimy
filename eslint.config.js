import js from "@eslint/js";
import comments from "@eslint-community/eslint-plugin-eslint-comments/configs";
import jsxA11y from "eslint-plugin-jsx-a11y-x";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";
import spotimy from "./lint-rules/index.js";

const layerPattern = (other) => ({
  regex: `^(\\.\\./)+${other}(/|$)`,
  message:
    "The page and the service never import each other. Shared schemas go in shared/.",
});

const databaseClients = [
  "@aws-sdk/client-dynamodb",
  "@aws-sdk/lib-dynamodb",
  "@aws-sdk/util-dynamodb",
];
const databaseMessage =
  "Only the store module, service/src/store/store.ts, reads or writes the table (table-design.md).";
const databasePaths = databaseClients.map((name) => ({
  name,
  message: databaseMessage,
}));
const databasePatterns = [
  {
    group: databaseClients.map((name) => `${name}/*`),
    message: databaseMessage,
  },
];

const databaseImports = {
  "no-restricted-imports": [
    "error",
    { paths: databasePaths, patterns: databasePatterns },
  ],
};

const otherLoggers = [
  "pino",
  "winston",
  "bunyan",
  "loglevel",
  "debug",
  "log4js",
  "consola",
  "@aws-lambda-powertools/logger",
].map((name) => ({
  name,
  message: "Log through the shared logger in service/src/log.ts (logging.md).",
}));

const serviceImports = {
  patterns: [layerPattern("web"), ...databasePatterns],
  paths: [...otherLoggers, ...databasePaths],
};

const processImports = ["process", "node:process"].map((name) => ({
  name,
  importNames: ["env", "stdout", "stderr"],
  message:
    "Read the environment in service/src/env.ts, and log through service/src/log.ts.",
}));

// Each boundary module disables these on the line where it reads outside
// data, with its reason (types-and-lint.md).
const boundaries = {
  "no-restricted-imports": [
    "error",
    { ...serviceImports, paths: [...serviceImports.paths, ...processImports] },
  ],
  "no-console": "error",
  "no-restricted-properties": [
    "error",
    {
      object: "process",
      property: "env",
      message:
        "Read the environment in service/src/env.ts, through its schema (types-and-lint.md).",
    },
    {
      object: "process",
      property: "stdout",
      message: "Log through the shared logger in service/src/log.ts.",
    },
    {
      object: "process",
      property: "stderr",
      message: "Log through the shared logger in service/src/log.ts.",
    },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: "MemberExpression[property.name='body']",
      message:
        "Read a body in service/src/http.ts, through its schema (types-and-lint.md).",
    },
    {
      selector: "ObjectPattern > Property[key.name='body']",
      message:
        "Read a body in service/src/http.ts, through its schema (types-and-lint.md).",
    },
    {
      // Response.json() builds a response. It reads nothing.
      selector:
        "CallExpression[callee.property.name=/^(json|text|formData|arrayBuffer|blob|bytes)$/]:not([callee.object.name='Response'])",
      message:
        "Read a body in service/src/http.ts, through its schema (types-and-lint.md).",
    },
  ],
};

export default defineConfig(
  globalIgnores(["**/dist/", ".serverless/", "docs/", "coverage/"]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  comments.recommended,
  {
    files: ["**/*.{js,ts,tsx}"],
    plugins: { spotimy },
    rules: {
      "spotimy/no-hand-built-key": "error",
      "spotimy/no-scan": "error",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: databaseImports,
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error",
    },
    rules: {
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "ts-nocheck": true,
        },
      ],
      "@typescript-eslint/no-unsafe-type-assertion": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        {
          considerDefaultExhaustiveForUnions: false,
          requireDefaultForNonUnion: true,
        },
      ],
      "@eslint-community/eslint-comments/require-description": "error",
      "@eslint-community/eslint-comments/no-unlimited-disable": "error",
      "@eslint-community/eslint-comments/disable-enable-pair": [
        "error",
        { allowWholeFile: false },
      ],
    },
  },
  {
    files: ["web/src/**/*.{ts,tsx}"],
    extends: [
      reactHooks.configs.flat["recommended-latest"],
      jsxA11y.configs.strict,
    ],
    languageOptions: { globals: globals.browser },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [layerPattern("service"), ...databasePatterns],
          paths: databasePaths,
        },
      ],
      // The preset sets these to warn. A rule is an error or off.
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/incompatible-library": "error",
      "react-hooks/unsupported-syntax": "error",
    },
  },
  {
    files: ["service/**/*.ts"],
    rules: { "no-restricted-imports": ["error", serviceImports] },
  },
  {
    files: ["service/src/**/*.ts"],
    ignores: ["service/src/**/*.test.ts"],
    rules: boundaries,
  },
  {
    files: ["service/src/store/keys.ts"],
    rules: { "spotimy/no-hand-built-key": "off" },
  },
  {
    // The store module is the one place the database client is imported.
    files: ["service/src/store/store.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [layerPattern("web")],
          paths: [...otherLoggers, ...processImports],
        },
      ],
    },
  },
  {
    // Starts the local database for the integration tier, and reads it back.
    files: ["test/dynamodb.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  {
    files: ["**/*.browser.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "playwright",
              message:
                "Open pages with openPage from test/browser.ts, which keeps the browser offline.",
            },
            ...databasePaths,
          ],
          patterns: databasePatterns,
        },
      ],
    },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);

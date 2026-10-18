// eslint.config.js decides which files each rule covers.
import { partitionKeys, sortKeys } from "../service/src/store/keys.ts";

const keyNames = [...Object.values(partitionKeys), ...Object.values(sortKeys)];
const isKey = (text) =>
  keyNames.some((name) =>
    name.endsWith("#") ? text.startsWith(name) : text === name,
  );

const noHandBuiltKey = {
  meta: {
    type: "problem",
    docs: { description: "A table key is built only in the key module." },
    schema: [],
    messages: {
      handBuilt:
        "Build a table key with service/src/store/keys.ts (table-design.md).",
    },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === "string" && isKey(node.value)) {
          context.report({ node, messageId: "handBuilt" });
        }
      },
      TemplateLiteral(node) {
        const first = node.quasis[0]?.value.cooked ?? "";
        if (first !== "" && isKey(first)) {
          context.report({ node, messageId: "handBuilt" });
        }
      },
    };
  },
};

const scanNames = new Set(["ScanCommand", "paginateScan"]);

const noScan = {
  meta: {
    type: "problem",
    docs: { description: "The table is never scanned." },
    schema: [],
    messages: {
      scan: "The table is never scanned (table-design.md). Read along the keys.",
    },
  },
  create(context) {
    return {
      Identifier(node) {
        if (scanNames.has(node.name)) {
          context.report({ node, messageId: "scan" });
        }
      },
    };
  },
};

export default {
  meta: { name: "spotimy" },
  rules: { "no-hand-built-key": noHandBuiltKey, "no-scan": noScan },
};

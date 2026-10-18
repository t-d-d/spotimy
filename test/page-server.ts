// Global setup for the browser tier: builds the page and serves it on
// loopback. Each test fakes the API itself (test/browser.ts).
import { execFile } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { promisify } from "node:util";
import type { TestProject } from "vitest/node";
import { root } from "./repo.ts";

declare module "vitest" {
  export interface ProvidedContext {
    pageUrl: string;
  }
}

const run = promisify(execFile);

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};

export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const dist = join(root, "web", "dist");
  // The same build as the deploy's. Vitest sets NODE_ENV to test, which would
  // give the page React's development build, so the build runs on its own.
  await run(
    process.execPath,
    [
      join(root, "node_modules", "vite", "bin", "vite.js"),
      "build",
      "web",
      "--logLevel",
      "error",
    ],
    {
      cwd: root,
      env: { ...process.env, NODE_ENV: "production" },
    },
  );
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const file = normalize(join(dist, path === "/" ? "index.html" : path));
    if (!file.startsWith(dist)) {
      response.writeHead(404);
      response.end();
      return;
    }
    readFile(file).then(
      (body) => {
        response.writeHead(200, {
          "content-type": types[extname(file)] ?? "application/octet-stream",
        });
        response.end(body);
      },
      () => {
        response.writeHead(404);
        response.end();
      },
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("No port.");
  project.provide("pageUrl", `http://127.0.0.1:${String(address.port)}`);
  return () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => {
        resolve();
      });
    });
}

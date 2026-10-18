// Loopback stand-ins for the two AWS services the functions call besides
// DynamoDB: Parameter Store for the session key, and Lambda for starting the
// worker (test-tiers.md).
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { z } from "zod";
import { parseJson, readBody } from "./read-body.ts";

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("No port.");
  return `http://127.0.0.1:${String(address.port)}`;
}

const close = (server: Server) =>
  new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => {
      resolve();
    });
  });

export interface FakeParameters {
  endpoint: string;
  values: Map<string, string>;
  close: () => Promise<void>;
}

export async function startFakeParameters(): Promise<FakeParameters> {
  const values = new Map<string, string>();
  const server = createServer((request, response) => {
    void readBody(request).then((body) => {
      const { Name: name } = z
        .object({ Name: z.string().optional() })
        .parse(parseJson(body));
      const value = name === undefined ? undefined : values.get(name);
      if (value === undefined) {
        response.writeHead(400, {
          "content-type": "application/x-amz-json-1.1",
        });
        response.end(
          JSON.stringify({
            __type: "ParameterNotFound",
            message: "No such parameter",
          }),
        );
        return;
      }
      response.writeHead(200, { "content-type": "application/x-amz-json-1.1" });
      response.end(
        JSON.stringify({
          Parameter: { Name: name, Type: "SecureString", Value: value },
        }),
      );
    });
  });
  return { endpoint: await listen(server), values, close: () => close(server) };
}

export interface FakeLambda {
  endpoint: string;
  // Each payload the worker was started with, in order.
  invoked: unknown[];
  close: () => Promise<void>;
}

export async function startFakeLambda(): Promise<FakeLambda> {
  const invoked: unknown[] = [];
  const server = createServer((request, response) => {
    void readBody(request).then((body) => {
      if (
        !/^\/2015-03-31\/functions\/[^/]+\/invocations$/u.test(
          request.url ?? "",
        )
      ) {
        response.writeHead(404);
        response.end();
        return;
      }
      invoked.push(parseJson(body));
      response.writeHead(202);
      response.end();
    });
  });
  return {
    endpoint: await listen(server),
    invoked,
    close: () => close(server),
  };
}

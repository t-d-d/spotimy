// Read at run time, so the session key is never in the deployment
// definition or the function's settings (hosting.md).
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { z } from "zod";
import { awsClientConfig } from "./aws";

export const keyReadTimeoutMs = 2000;

const answerSchema = z.object({
  Parameter: z.object({ Value: z.string().min(32) }),
});

export function createKeyReader(config: {
  parameter: string;
  endpoint?: string | undefined;
}): () => Promise<string> {
  const { parameter, endpoint } = config;
  const client = new SSMClient(awsClientConfig(endpoint));
  let key: Promise<string> | undefined;
  return () => {
    key ??= client
      .send(
        new GetParameterCommand({ Name: parameter, WithDecryption: true }),
        { abortSignal: AbortSignal.timeout(keyReadTimeoutMs) },
      )
      .then((answer) => answerSchema.parse(answer).Parameter.Value)
      .catch((error: unknown) => {
        // Read it again next time, rather than keep the failure.
        key = undefined;
        throw error;
      });
    return key;
  };
}

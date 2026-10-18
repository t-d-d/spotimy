// In production the client finds its region and credentials in Lambda's
// environment. The integration tier's stand-ins accept any credentials.
export function awsClientConfig(endpoint: string | undefined) {
  return endpoint === undefined
    ? {}
    : {
        endpoint,
        region: "us-east-1",
        credentials: { accessKeyId: "local", secretAccessKey: "local" },
      };
}

export interface DeployResult {
  url: string;
}

export async function deployVercelRelay(
  token: string,
  projectName?: string,
): Promise<DeployResult> {
  // TODO(M4): upload the relay worker to vercel, poll until live, return its url
  void token;
  void projectName;
  throw new Error("TODO(M4): deployVercelRelay not implemented");
}

/** Deployment environments this app distinguishes for telemetry routing. */
export type DeploymentEnvironment = "production" | "preview" | "development";

const deploymentEnvironments: readonly DeploymentEnvironment[] = [
  "production",
  "preview",
  "development",
];

/**
 * Resolves the deployment environment for telemetry routing only — no code
 * path changes behavior on it, so the fail-fast startup contract stays
 * environment-independent. `VERCEL_ENV` is authoritative on Vercel; off
 * platform, only an explicit `NODE_ENV=production` counts as production.
 */
export function resolveEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): DeploymentEnvironment {
  const vercelEnv = source.VERCEL_ENV as DeploymentEnvironment | undefined;
  if (vercelEnv && deploymentEnvironments.includes(vercelEnv)) {
    return vercelEnv;
  }
  return source.NODE_ENV === "production" ? "production" : "development";
}

const projectSuffix: Record<DeploymentEnvironment, string> = {
  production: "",
  preview: "-preview",
  development: "-dev",
};

/**
 * Braintrust project for an environment, so local turns and preview
 * deployments never land in the project on-call reads during an incident.
 */
export function braintrustProject(
  agentName: string,
  environment: DeploymentEnvironment = resolveEnvironment(),
): string {
  return `${agentName}${projectSuffix[environment]}`;
}

export type RouteAuth = 'COGNITO' | 'NONE' | 'IAM' | 'CUSTOM';

export type RouteDef = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'ANY';
  path: string;                 // relative under basePath, no leading slash preferred
  entry: string;                // e.g. '../../../apps/functions/src/handlers/prompt/save-prompt.ts'
  handler?: string;             // default: 'handler'
  auth?: RouteAuth;             // default: 'COGNITO'
  extraEnv?: Record<string, string>;
  memorySize?: number;
  timeoutSeconds?: number;
  /** Extra npm packages to install alongside the bundle (not bundled by esbuild) */
  nodeModules?: string[];
  /**
   * Force the install step (`nodeModules`) to run inside the Lambda Docker image
   * instead of locally. Required for any package that ships a native binary
   * (e.g. `@napi-rs/canvas`) so the Linux x64 build is shipped regardless of
   * the developer's host platform.
   */
  forceDockerBundling?: boolean;
};

export type DomainRoutes = {
  basePath: string;             // e.g. 'prompt'
  routes: RouteDef[];
};
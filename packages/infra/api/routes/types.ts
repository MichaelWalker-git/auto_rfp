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
  /**
   * Optional per-route Log Group retention override. `'mandated'` applies the
   * team-mandated stage-aware policy (TWO_WEEKS non-prod / INFINITE prod)
   * instead of the factory's uniform ONE_MONTH default. Additive opt-in:
   * routes that don't set it keep the existing default untouched.
   */
  logRetention?: 'mandated';
};

export type DomainRoutes = {
  basePath: string;             // e.g. 'prompt'
  routes: RouteDef[];
};
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
};

export type DomainRoutes = {
  basePath: string;             // e.g. 'prompt'
  routes: RouteDef[];
};
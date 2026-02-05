export type RouteAuth = 'COGNITO' | 'NONE' | 'IAM' | 'CUSTOM';

export type RouteDef = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'ANY';
  path: string;                 // relative under basePath, no leading slash preferred
  entry: string;                // e.g. 'lambda/prompt/save-prompt.ts'
  handler?: string;             // default: 'handler'
  auth?: RouteAuth;             // default: 'COGNITO'
  extraEnv?: Record<string, string>;
  memorySize?: number;
  timeoutSeconds?: number;
};

export type DomainRoutes = {
  basePath: string;             // e.g. 'prompt'
  routes: RouteDef[];
};
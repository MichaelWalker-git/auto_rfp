export function requireEnv(name: string, defaultValue?: string): string {
  const value = process.env[name];
  if (value && value !== '') return value;
  if (defaultValue) return defaultValue;
  throw new Error(`Missing required environment variable: ${name}`);
}
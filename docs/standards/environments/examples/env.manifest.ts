// Copy to env.manifest.ts at the app root. Values come from Infisical, never this file.
export const ENV_CONFIG = {
  appName: 'replace-app-name',
  source: { environments: { local: 'dev', production: 'prod' }, paths: ['/', '/replace-app-name'] },
};
export const ENVIRONMENTS = ['local', 'production'] as const;
export const CONSUMERS = ['vite-build', 'worker-runtime'] as const;
export const ENTRIES = [
  { key: 'publicApi', infisicalKey: 'PUBLIC_API_URL', secret: false,
    lands: { 'vite-build': { name: 'VITE_API_URL', environments: ['local', 'production'] } } },
  { key: 'apiSecret', infisicalKey: 'API_SECRET', secret: true,
    lands: { 'worker-runtime': { name: 'API_SECRET', environments: ['local', 'production'] } } },
];
export function placementsFor(environment: string) {
  return ENTRIES.flatMap(entry => Object.entries(entry.lands).flatMap(([consumer, landing]) => {
    if (!landing || !landing.environments.includes(environment)) return [];
    const destination = consumer === 'vite-build'
      ? { kind: 'file' as const, path: '.env.local' }
      : environment === 'local'
        ? { kind: 'file' as const, path: '.dev.vars' }
        : { kind: 'worker' as const, worker: 'replace-worker-name' };
    return [{ entry, consumer, environment, name: landing.name, destination, suppliedBy: null }];
  }));
}

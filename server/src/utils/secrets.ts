export function getSecret(envName: string, developmentFallback: string): string {
  const value = process.env[envName]?.trim() || developmentFallback;

  if (process.env.NODE_ENV === 'production') {
    if (!process.env[envName]?.trim() || value === developmentFallback || value.length < 32) {
      throw new Error(`${envName} must be configured with a strong value in production`);
    }
  }

  return value;
}

export function requireWebhookSecretInProduction(secret: string | null | undefined): boolean {
  return process.env.NODE_ENV !== 'production' || Boolean(secret?.trim());
}

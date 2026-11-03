export function getMissingProductionConfig(env: Record<string, unknown> | undefined): string[] {
  if (env?.ENVIRONMENT !== 'production') return [];

  const required = [
    'MFA_ENCRYPTION_KEY',
    'RESEND_API_KEY',
    'ALLOWED_ORIGINS'
  ];

  return required.filter((name) => {
    const value = env?.[name];
    return typeof value !== 'string' || value.trim() === '';
  });
}

const getEvolutionConfig = () => ({
  baseUrl: process.env.EVOLUTION_API_BASE_URL?.trim(),
  apiKey: process.env.EVOLUTION_API_KEY?.trim(),
  instanceName: process.env.EVOLUTION_INSTANCE_NAME?.trim(),
});

const buildEvolutionSendTextUrl = (baseUrl: string, instanceName: string) => {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '');
  return `${normalizedBaseUrl}/message/sendText/${encodeURIComponent(instanceName)}`;
};

export const sendTextMessage = async (phone: string, text: string, instanceNameOverride?: string | null): Promise<void> => {
  const config = getEvolutionConfig();
  const instanceName = instanceNameOverride?.trim() || config.instanceName;

  if (!config.baseUrl || !config.apiKey || !instanceName) {
    throw new Error('Evolution API configuration is incomplete');
  }

  const response = await fetch(buildEvolutionSendTextUrl(config.baseUrl, instanceName), {
    method: 'POST',
    headers: {
      apikey: config.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      number: phone,
      text,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Evolution API sendText failed with ${response.status}: ${errorText}`);
  }
};

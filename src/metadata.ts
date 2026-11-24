const debug = false;

/**
 * Get cost and metadata for a generation from OpenRouter.
 */
export async function getGenerationMetadata({
  apiKey,
  generationId,
}: {
  apiKey: string;
  generationId: string;
}): Promise<{
  upstreamCostCents: number;
  provider: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const url = `https://openrouter.ai/api/v1/generation?id=${generationId}`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
  };

  // Retry logic for potential 404 from OpenRouter
  const maxRetries = 10;
  const retryDelay = 1000; // 1 second

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    if (response.ok) {
      const data = await response.json();
      if (debug) {
        console.log("[getCost] data:", JSON.stringify(data, null, 2));
      }

      const upstreamCostInDollars = data.data.total_cost;
      const upstreamCostCents = upstreamCostInDollars * 100;
      const provider = data.data.provider_name;
      const inputTokens = data.data.tokens_prompt;
      const outputTokens = data.data.tokens_completion;

      return {
        upstreamCostCents,
        provider,
        inputTokens,
        outputTokens,
      };
    } else {
      const responseText = await response.text();
      if (debug) {
        console.error(
          `Attempt ${attempt} failed. Status: ${response.status}, response text: ${responseText}`,
        );
      }

      if (attempt < maxRetries) {
        if (debug) {
          console.log(`Retrying in ${retryDelay / 1000} seconds...`);
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      } else {
        throw new Error(
          `HTTP error! Status: ${response.status} after ${maxRetries} attempts.`,
        );
      }
    }
  }

  // You theoretically never reach here because of the throw above
  throw new Error("Failed to get generation metadata.");
}

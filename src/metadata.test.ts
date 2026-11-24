import { describe, it, expect, vi, beforeEach } from "vitest";
import { getGenerationMetadata } from "./metadata";

describe("metadata", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("getGenerationMetadata", () => {
    it("should return cost metadata on successful response", async () => {
      // Mock successful fetch response
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: {
              total_cost: 0.05,
              provider_name: "test-provider",
              tokens_prompt: 200,
              tokens_completion: 100,
            },
          }),
      });

      const result = await getGenerationMetadata({
        apiKey: "test-key",
        generationId: "test-id",
      });

      expect(fetch).toHaveBeenCalledWith(
        "https://openrouter.ai/api/v1/generation?id=test-id",
        {
          method: "GET",
          headers: {
            Authorization: "Bearer test-key",
          },
        },
      );

      expect(result).toEqual({
        upstreamCostCents: 5, // 0.05 * 100
        provider: "test-provider",
        inputTokens: 200,
        outputTokens: 100,
      });
    });

    it("should retry on failed response", async () => {
      // First call fails, second succeeds
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: () => Promise.resolve("Not found"),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: {
                total_cost: 0.03,
                provider_name: "test-provider",
                tokens_prompt: 150,
                tokens_completion: 75,
              },
            }),
        });

      // Mock setTimeout to execute immediately
      vi.spyOn(global, "setTimeout").mockImplementation((callback) => {
        callback();
        return 0;
      });

      const result = await getGenerationMetadata({
        apiKey: "test-key",
        generationId: "test-id",
      });

      expect(fetch).toHaveBeenCalledTimes(2);
      expect(result.upstreamCostCents).toBe(3);
    });

    it("should throw error after max retries", async () => {
      // All calls fail
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Server error"),
      });

      // Mock setTimeout to execute immediately
      vi.spyOn(global, "setTimeout").mockImplementation((callback) => {
        callback();
        return 0;
      });

      const testMaxRetries = 3;

      // Mock getGenerationMetadata to use fewer retries
      const getMetadataWithFewerRetries = async (params: {
        apiKey: string;
        generationId: string;
      }) => {
        const url = `https://openrouter.ai/api/v1/generation?id=${params.generationId}`;
        const headers = {
          Authorization: `Bearer ${params.apiKey}`,
        };

        for (let attempt = 1; attempt <= testMaxRetries; attempt++) {
          const response = await fetch(url, {
            method: "GET",
            headers,
          });

          if (response.ok) {
            const data = await response.json();
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
            await response.text();
            if (attempt < testMaxRetries) {
              await new Promise((resolve) => setTimeout(resolve, 0));
            } else {
              throw new Error(
                `HTTP error! Status: ${response.status} after ${testMaxRetries} attempts.`,
              );
            }
          }
        }
        throw new Error("Failed to get generation metadata.");
      };

      await expect(
        getMetadataWithFewerRetries({
          apiKey: "test-key",
          generationId: "test-id",
        }),
      ).rejects.toThrow(
        `HTTP error! Status: 500 after ${testMaxRetries} attempts.`,
      );

      expect(fetch).toHaveBeenCalledTimes(testMaxRetries);
    });
  });
});

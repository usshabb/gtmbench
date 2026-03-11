import { env } from "./env.js";

interface FiberEnrichmentResult {
  success: boolean;
  payload?: Record<string, unknown>;
  error?: string;
}

export async function enrichDomainWithFiber(domain: string): Promise<FiberEnrichmentResult> {
  const requestBody = {
    apiKey: env.FIBER_API_KEY,
    companyDomain: { value: domain },
  };

  const url = `${env.FIBER_API_BASE_URL}/v1/kitchen-sink/company`;
  console.log("[fiber] POST %s", url);
  console.log("[fiber] request body:", JSON.stringify(requestBody));

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const responseBody = (await response.json()) as Record<string, unknown>;
    console.log("[fiber] response status: %d", response.status);
    console.log("[fiber] response body:", JSON.stringify(responseBody));

    if (!response.ok) {
      return {
        success: false,
        error: `Fiber API responded with ${response.status}`,
        payload: responseBody,
      };
    }

    return { success: true, payload: responseBody };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fiber API request failed";
    console.error("[fiber] enrichDomainWithFiber error:", message);
    return { success: false, error: message };
  }
}

export async function searchBuyersWithFiber(
  domain: string,
  titles: string[],
  cursor: string | null = null,
): Promise<FiberEnrichmentResult> {
  const requestBody = {
    apiKey: env.FIBER_API_KEY,
    searchParams: {
      jobTitleV3: {
        anyOf: titles.map((term) => ({ term, type: "plain" })),
      },
    },
    pageSize: 25,
    cursor,
    currentCompanies: [{ domain }],
    prospectExclusionListIDs: [],
    companyExclusionListIDs: [],
  };

  const url = `${env.FIBER_API_BASE_URL}/v1/people-search`;
  console.log("[fiber] POST %s", url);
  console.log("[fiber] request body:", JSON.stringify(requestBody));

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const responseBody = (await response.json()) as Record<string, unknown>;
    console.log("[fiber] response status: %d", response.status);
    console.log("[fiber] response body:", JSON.stringify(responseBody));

    if (!response.ok) {
      return {
        success: false,
        error: `Fiber API responded with ${response.status}`,
        payload: responseBody,
      };
    }

    return { success: true, payload: responseBody };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fiber people-search request failed";
    console.error("[fiber] searchBuyersWithFiber error:", message);
    return { success: false, error: message };
  }
}

export async function enrichPersonWithFiber(linkedinUrl: string): Promise<FiberEnrichmentResult> {
  // Extract slug from URL like https://www.linkedin.com/in/arthurleopold
  const slug = linkedinUrl.split("/in/")[1]?.replace(/\/+$/, "") ?? "";

  const requestBody = {
    apiKey: env.FIBER_API_KEY,
    profileIdentifier: {
      identifier: "linkedinSlug",
      value: slug,
    },
  };

  const url = `${env.FIBER_API_BASE_URL}/v1/kitchen-sink/person`;
  console.log("[fiber] POST %s", url);
  console.log("[fiber] request body:", JSON.stringify(requestBody));

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const responseBody = (await response.json()) as Record<string, unknown>;
    console.log("[fiber] response status: %d", response.status);
    console.log("[fiber] response body:", JSON.stringify(responseBody));

    if (!response.ok) {
      return {
        success: false,
        error: `Fiber API responded with ${response.status}`,
        payload: responseBody,
      };
    }

    return { success: true, payload: responseBody };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fiber API request failed";
    console.error("[fiber] enrichPersonWithFiber error:", message);
    return { success: false, error: message };
  }
}

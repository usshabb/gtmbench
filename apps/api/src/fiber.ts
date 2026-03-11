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

  try {
    const response = await fetch(`${env.FIBER_API_BASE_URL}/v1/kitchen-sink/company`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const responseBody = (await response.json()) as Record<string, unknown>;

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

  try {
    const response = await fetch(`${env.FIBER_API_BASE_URL}/v1/people-search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const responseBody = (await response.json()) as Record<string, unknown>;

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

  try {
    const response = await fetch(`${env.FIBER_API_BASE_URL}/v1/kitchen-sink/person`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    const responseBody = (await response.json()) as Record<string, unknown>;

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
    return { success: false, error: message };
  }
}

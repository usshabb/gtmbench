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

/**
 * Try to find a work email for a person using Fiber people-search.
 * Uses name + company domain as search criteria.
 * Returns the work_email string if found, or null.
 */
export async function findPersonEmailWithFiber(
  firstName: string,
  lastName: string,
  companyDomain: string,
): Promise<string | null> {
  const requestBody = {
    apiKey: env.FIBER_API_KEY,
    searchParams: {
      name: {
        value: `${firstName} ${lastName}`.trim(),
        looseMatch: false,
      },
    },
    currentCompanies: [{ domain: companyDomain }],
    pageSize: 1,
    prospectExclusionListIDs: [],
    companyExclusionListIDs: [],
  };

  const url = `${env.FIBER_API_BASE_URL}/v1/people-search`;
  console.log("[fiber] findPersonEmailWithFiber POST %s for %s %s @ %s", url, firstName, lastName, companyDomain);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const responseBody = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      console.warn("[fiber] findPersonEmail: non-ok response %d", response.status);
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results = (responseBody as any)?.output?.data as any[] | undefined;
    const match = results?.[0];
    const email: string | null = match?.work_email ?? match?.emails?.[0] ?? match?.personal_email ?? null;
    console.log("[fiber] findPersonEmail result: %s", email ?? "none");
    return email;
  } catch (error) {
    console.error("[fiber] findPersonEmailWithFiber error:", error instanceof Error ? error.message : error);
    return null;
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


/**
 * Look up a person by work email using Fiber email-to-person/single.
 * Returns the full enrichment payload (same shape as kitchen-sink/person) or null on failure.
 */
export async function enrichPersonByEmailWithFiber(email: string): Promise<FiberEnrichmentResult> {
  const requestBody = {
    apiKey: env.FIBER_API_KEY,
    email,
  };

  const url = `${env.FIBER_API_BASE_URL}/v1/email-to-person/single`;
  console.log("[fiber] enrichPersonByEmailWithFiber POST %s for %s", url, email);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const responseBody = (await response.json()) as Record<string, unknown>;
    console.log("[fiber] email-to-person response status: %d", response.status);
    console.log("[fiber] email-to-person response body:", JSON.stringify(responseBody));

    if (!response.ok) {
      return { success: false, error: `Fiber API responded with ${response.status}`, payload: responseBody };
    }

    return { success: true, payload: responseBody };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Fiber email-to-person request failed";
    console.error("[fiber] enrichPersonByEmailWithFiber error:", message);
    return { success: false, error: message };
  }
}

/**
 * Find a person's contact details using Fiber contact-details/sync API.
 * Returns the first work email found, or personal email as fallback.
 */
export async function findEmailWithContactDetails(
  linkedinUrl: string,
): Promise<{ email: string | null; phones: string[] }> {
  const requestBody = {
    apiKey: env.FIBER_API_KEY,
    linkedinUrl,
    enrichmentType: {
      getWorkEmails: true,
      getPersonalEmails: false,
      getPhoneNumbers: false,
    },
    exhaustive: false,
  };

  const url = `${env.FIBER_API_BASE_URL}/v1/contact-details/sync`;
  console.log("[fiber] contact-details/sync POST %s for %s", url, linkedinUrl);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const responseBody = (await response.json()) as Record<string, unknown>;
    console.log("[fiber] contact-details/sync response status: %d", response.status);
    console.log("[fiber] contact-details/sync response body:", JSON.stringify(responseBody));

    if (!response.ok) {
      console.warn("[fiber] contact-details/sync failed:", JSON.stringify(responseBody));
      return { email: null, phones: [] };
    }

    // Response shape: { output: { profile: { emails: [{ email, type, status }], phoneNumbers: [...] } } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = responseBody as any;
    const emailEntries = (data?.output?.profile?.emails ?? []) as { email: string; type: string; status?: string }[];

    // Prefer work emails with valid status, then any work email, then personal
    const workEmail = emailEntries.find((e) => e.type === "work" && e.status === "valid")?.email
      ?? emailEntries.find((e) => e.type === "work")?.email
      ?? emailEntries.find((e) => e.type === "personal")?.email
      ?? null;

    console.log("[fiber] contact-details/sync found email: %s (from %d entries)", workEmail ?? "none", emailEntries.length);

    return { email: workEmail, phones: [] };
  } catch (error) {
    console.error("[fiber] findEmailWithContactDetails error:", error instanceof Error ? error.message : error);
    return { email: null, phones: [] };
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

import { env } from "./env.js";
import type { LinkedinPostData } from "./types.js";

interface LinkedinPostsApiResponse {
  output?: {
    data?: LinkedinRawPost[];
    cursor?: string | null;
  };
}

interface LinkedinRawPost {
  postId: string;
  author: {
    linkedinUrl: string;
    name: string;
    profilePicture: string | null;
  };
  postedAt: {
    noLaterThan: string;
    noEarlierThan: string;
  };
  engagement: {
    numComments: number;
    numShares: number;
    numReactions: number;
  };
  imageUrls: string[] | null;
  postUrl: string;
  video: unknown | null;
  caption: string | null;
  resharedPost: unknown | null;
}

interface FetchLinkedinPostsResult {
  success: boolean;
  posts: LinkedinPostData[];
  cursor?: string | null;
  error?: string;
}

export async function fetchLinkedinPosts(
  linkedinUrl: string,
  cursor: string | null = null,
): Promise<FetchLinkedinPostsResult> {
  const requestBody = {
    apiKey: env.FIBER_API_KEY,
    identifier: linkedinUrl,
    cursor,
  };

  const url = `${env.FIBER_API_BASE_URL}/v1/linkedin-live-fetch/profile-posts`;
  console.log("[linkedin] POST %s", url);
  console.log("[linkedin] request body:", JSON.stringify(requestBody));

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const responseText = await response.text();
    console.log("[linkedin] response status: %d", response.status);
    console.log("[linkedin] response headers:", JSON.stringify(Object.fromEntries(response.headers.entries())));
    console.log("[linkedin] response body:", responseText);

    if (!response.ok) {
      return {
        success: false,
        posts: [],
        error: `Fiber LinkedIn API responded with ${response.status}`,
      };
    }

    const body = JSON.parse(responseText) as LinkedinPostsApiResponse;
    const rawPosts = body.output?.data ?? [];

    const posts: LinkedinPostData[] = rawPosts.map((raw) => ({
      postId: raw.postId,
      postUrl: raw.postUrl,
      caption: raw.caption,
      postedAt: raw.postedAt.noLaterThan,
      authorName: raw.author.name,
      authorLinkedinUrl: raw.author.linkedinUrl,
      authorProfilePicture: raw.author.profilePicture,
      engagement: {
        numComments: raw.engagement.numComments,
        numShares: raw.engagement.numShares,
        numReactions: raw.engagement.numReactions,
      },
      imageUrls: raw.imageUrls,
      hasVideo: raw.video != null,
      isReshare: raw.resharedPost != null,
    }));

    return {
      success: true,
      posts,
      cursor: body.output?.cursor ?? null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "LinkedIn posts fetch failed";
    return { success: false, posts: [], error: message };
  }
}

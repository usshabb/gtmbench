import { google } from "googleapis";
import { env } from "./env.js";
import { getGoogleTokensCollection } from "./db.js";

export function createOAuth2Client() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
}

/**
 * Create an OAuth2 client with credentials set, and a listener that persists
 * refreshed tokens back to the database so they survive across requests.
 */
export function createAuthenticatedClient(
  accessToken: string,
  refreshToken: string | null,
  userEmail: string,
) {
  const client = createOAuth2Client();
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });

  // When the googleapis library auto-refreshes the access token, persist the new one
  client.on("tokens", async (newTokens) => {
    try {
      const col = await getGoogleTokensCollection();
      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (newTokens.access_token) updates.accessToken = newTokens.access_token;
      if (newTokens.refresh_token) updates.refreshToken = newTokens.refresh_token;
      if (newTokens.expiry_date) updates.expiryDate = newTokens.expiry_date;
      await col.updateOne({ userEmail }, { $set: updates });
    } catch (err) {
      console.error(`[google] Failed to persist refreshed token for ${userEmail}:`, err);
    }
  });

  return client;
}

const SIGNIN_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
];

const CONNECT_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
];

/** Sign-in URL — only requests basic profile scopes, no gmail/calendar. */
export function getGoogleSigninUrl(state: string): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: "online",
    scope: SIGNIN_SCOPES,
    state,
    prompt: "select_account",
  });
}

/** Connect URL — requests gmail + calendar scopes with offline access for refresh token. */
export function getGoogleAuthUrl(state: string): string {
  const client = createOAuth2Client();
  return client.generateAuthUrl({
    access_type: "offline",
    scope: CONNECT_SCOPES,
    state,
    prompt: "consent",
  });
}

export async function exchangeCodeForTokens(code: string) {
  const client = createOAuth2Client();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export async function getUserInfoFromGoogle(
  accessToken: string,
  refreshToken: string | null,
): Promise<{ email: string; name?: string; picture?: string }> {
  const client = createOAuth2Client();
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken });
  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const info = await oauth2.userinfo.get();
  if (!info.data.email) throw new Error("No email returned from Google");
  return {
    email: info.data.email,
    name: info.data.name ?? undefined,
    picture: info.data.picture ?? undefined,
  };
}

export interface EmailThread {
  id: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
}

export async function getEmailsWithPerson(
  accessToken: string,
  refreshToken: string | null,
  personEmail: string,
  userEmail?: string,
): Promise<EmailThread[]> {
  const client = userEmail
    ? createAuthenticatedClient(accessToken, refreshToken, userEmail)
    : (() => { const c = createOAuth2Client(); c.setCredentials({ access_token: accessToken, refresh_token: refreshToken }); return c; })();

  const gmail = google.gmail({ version: "v1", auth: client });

  const listRes = await gmail.users.threads.list({
    userId: "me",
    q: `from:${personEmail} OR to:${personEmail}`,
    maxResults: 5,
  });

  const threads = listRes.data.threads ?? [];
  const results: EmailThread[] = [];

  for (const thread of threads) {
    try {
      const threadData = await gmail.users.threads.get({
        userId: "me",
        id: thread.id!,
        format: "metadata",
        metadataHeaders: ["Subject", "From", "To", "Date"],
      });

      const msg = threadData.data.messages?.[0];
      const headers = msg?.payload?.headers ?? [];
      const h = (name: string) =>
        headers.find((hdr) => hdr.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

      results.push({
        id: thread.id!,
        subject: h("Subject") || "(no subject)",
        from: h("From"),
        to: h("To"),
        date: h("Date"),
        snippet: msg?.snippet ?? "",
      });
    } catch {
      // Skip threads that fail to load
    }
  }

  return results;
}

export interface InboxThread extends EmailThread {
  personEmail: string; // which tracked person this thread is associated with
  personName?: string;
  isUnread: boolean;
}

/**
 * Fetch inbox threads across all tracked person emails in a single Gmail query.
 * personEmails is a map of email -> display name.
 */
export async function getInboxThreads(
  accessToken: string,
  refreshToken: string | null,
  personEmails: { email: string; name: string }[],
  maxResults = 50,
  userEmail?: string,
): Promise<InboxThread[]> {
  if (personEmails.length === 0) return [];

  const client = userEmail
    ? createAuthenticatedClient(accessToken, refreshToken, userEmail)
    : (() => { const c = createOAuth2Client(); c.setCredentials({ access_token: accessToken, refresh_token: refreshToken }); return c; })();
  const gmail = google.gmail({ version: "v1", auth: client });

  // Build combined query: (from:a OR to:a) OR (from:b OR to:b) ...
  // Gmail query has limits so cap at 30 addresses
  const capped = personEmails.slice(0, 30);
  const q = capped.map((p) => `(from:${p.email} OR to:${p.email})`).join(" OR ");

  const listRes = await gmail.users.threads.list({ userId: "me", q, maxResults });
  const threads = listRes.data.threads ?? [];

  const emailSet = new Set(capped.map((p) => p.email.toLowerCase()));
  const emailToName = new Map(capped.map((p) => [p.email.toLowerCase(), p.name]));

  const results: InboxThread[] = [];

  await Promise.all(
    threads.map(async (thread) => {
      try {
        const threadData = await gmail.users.threads.get({
          userId: "me",
          id: thread.id!,
          format: "metadata",
          metadataHeaders: ["Subject", "From", "To", "Date"],
        });

        const messages = threadData.data.messages ?? [];
        const latestMsg = messages[messages.length - 1] ?? messages[0];
        const headers = latestMsg?.payload?.headers ?? [];
        const h = (name: string) =>
          headers.find((hdr) => hdr.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

        const from = h("From");
        const to = h("To");

        // Find which tracked person this thread belongs to
        const allAddresses = messages
          .flatMap((m) => {
            const mh = m.payload?.headers ?? [];
            return [
              mh.find((x) => x.name?.toLowerCase() === "from")?.value ?? "",
              mh.find((x) => x.name?.toLowerCase() === "to")?.value ?? "",
            ];
          })
          .join(" ")
          .toLowerCase();
        const matched = capped.find((p) => allAddresses.includes(p.email.toLowerCase()));
        if (!matched) return;

        // isUnread: any message in the thread has the UNREAD label
        const isUnread = messages.some((m) => m.labelIds?.includes("UNREAD") ?? false);

        results.push({
          id: thread.id!,
          subject: h("Subject") || "(no subject)",
          from,
          to,
          date: h("Date"),
          snippet: latestMsg?.snippet ?? "",
          personEmail: matched.email,
          personName: emailToName.get(matched.email.toLowerCase()),
          isUnread,
        });
      } catch {
        // Skip threads that fail
      }
    }),
  );

  // Sort newest first
  results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return results;
}

/**
 * Mark a Gmail thread as read by removing the UNREAD label from all messages.
 */
export async function markThreadAsRead(
  accessToken: string,
  refreshToken: string | null,
  threadId: string,
  userEmail?: string,
): Promise<void> {
  const client = userEmail
    ? createAuthenticatedClient(accessToken, refreshToken, userEmail)
    : (() => { const c = createOAuth2Client(); c.setCredentials({ access_token: accessToken, refresh_token: refreshToken }); return c; })();
  const gmail = google.gmail({ version: "v1", auth: client });

  await gmail.users.threads.modify({
    userId: "me",
    id: threadId,
    requestBody: {
      removeLabelIds: ["UNREAD"],
    },
  });
}

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: string; // ISO datetime or date
  end: string;
  allDay: boolean;
  attendees: { email: string; name?: string; self?: boolean; responseStatus?: string }[];
  meetLink?: string;
  htmlLink?: string;
  organizer?: { email: string; name?: string; self?: boolean };
}

export async function getCalendarEvents(
  accessToken: string,
  refreshToken: string | null,
  timeMin: string,
  timeMax: string,
  userEmail?: string,
): Promise<CalendarEvent[]> {
  const client = userEmail
    ? createAuthenticatedClient(accessToken, refreshToken, userEmail)
    : (() => { const c = createOAuth2Client(); c.setCredentials({ access_token: accessToken, refresh_token: refreshToken }); return c; })();

  const calendar = google.calendar({ version: "v3", auth: client });

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 100,
  });

  const items = res.data.items ?? [];

  return items.map((e) => {
    const allDay = !!e.start?.date;
    const start = (e.start?.dateTime ?? e.start?.date) as string;
    const end = (e.end?.dateTime ?? e.end?.date) as string;
    const meetLink =
      e.hangoutLink ??
      e.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === "video")?.uri ??
      undefined;

    return {
      id: e.id ?? "",
      summary: e.summary ?? "(No title)",
      description: e.description ?? undefined,
      location: e.location ?? undefined,
      start,
      end,
      allDay,
      attendees: (e.attendees ?? []).map((a) => ({
        email: a.email ?? "",
        name: a.displayName ?? undefined,
        self: a.self ?? false,
        responseStatus: a.responseStatus ?? undefined,
      })),
      meetLink,
      htmlLink: e.htmlLink ?? undefined,
      organizer: e.organizer
        ? { email: e.organizer.email ?? "", name: e.organizer.displayName ?? undefined, self: e.organizer.self ?? false }
        : undefined,
    };
  });
}

export async function sendGmail(
  accessToken: string,
  refreshToken: string | null,
  to: string,
  subject: string,
  body: string,
  userEmail?: string,
): Promise<void> {
  const client = userEmail
    ? createAuthenticatedClient(accessToken, refreshToken, userEmail)
    : (() => { const c = createOAuth2Client(); c.setCredentials({ access_token: accessToken, refresh_token: refreshToken }); return c; })();

  const gmail = google.gmail({ version: "v1", auth: client });

  const raw = Buffer.from(
    [`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", body].join(
      "\r\n",
    ),
  ).toString("base64url");

  await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
}

export interface ThreadMessage {
  id: string;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  date: string;
  body: string;
  isUnread: boolean;
  messageId?: string; // Message-ID header for threading
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTextBody(payload: any): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    const raw = Buffer.from(payload.body.data as string, "base64url").toString("utf-8");
    return stripQuotedText(raw);
  }
  if (payload.parts) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const part of payload.parts as any[]) {
      const text = extractTextBody(part);
      if (text) return text;
    }
  }
  return "";
}

/** Strip quoted / forwarded text from an email body so only the latest reply shows. */
function stripQuotedText(body: string): string {
  // Common quote markers — match the first one found and discard everything after it
  const patterns = [
    /^--- original message ---/im,
    /^-{2,}\s*Forwarded message\s*-{2,}/im,
    /^On .{10,80} wrote:\s*$/im,
    /^\d{4}年.{2,30}に.{2,60}wrote:\s*$/im,          // Japanese Gmail quote header
    /^>\s/m,                                            // traditional > quoting (first occurrence)
    /^From:\s.+/im,                                     // Outlook-style "From: ..."
    /^_{5,}/m,                                          // Outlook "________" separator
  ];

  let earliest = body.length;
  for (const re of patterns) {
    const m = re.exec(body);
    if (m && m.index < earliest) earliest = m.index;
  }

  return body.slice(0, earliest).trimEnd();
}

export async function getThreadMessages(
  accessToken: string,
  refreshToken: string | null,
  threadId: string,
  userEmail?: string,
): Promise<ThreadMessage[]> {
  const client = userEmail
    ? createAuthenticatedClient(accessToken, refreshToken, userEmail)
    : (() => { const c = createOAuth2Client(); c.setCredentials({ access_token: accessToken, refresh_token: refreshToken }); return c; })();
  const gmail = google.gmail({ version: "v1", auth: client });

  const threadData = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
  const messages = threadData.data.messages ?? [];

  return messages.map((msg) => {
    const headers = msg.payload?.headers ?? [];
    const h = (name: string) =>
      headers.find((hdr) => hdr.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

    return {
      id: msg.id!,
      from: h("From"),
      to: h("To"),
      cc: h("Cc") || undefined,
      subject: h("Subject"),
      date: h("Date"),
      body: extractTextBody(msg.payload),
      isUnread: msg.labelIds?.includes("UNREAD") ?? false,
      messageId: h("Message-ID") || undefined,
    };
  });
}

export async function sendNewGmail(
  accessToken: string,
  refreshToken: string | null,
  to: string,
  subject: string,
  body: string,
  userEmail?: string,
  trackingPixelUrl?: string,
  signatureHtml?: string,
): Promise<string> {
  const client = userEmail
    ? createAuthenticatedClient(accessToken, refreshToken, userEmail)
    : (() => { const c = createOAuth2Client(); c.setCredentials({ access_token: accessToken, refresh_token: refreshToken }); return c; })();
  const gmail = google.gmail({ version: "v1", auth: client });

  const escapedBody = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  const pixelTag = trackingPixelUrl
    ? `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="" />`
    : "";
  const sigBlock = signatureHtml ? `<br><div style="margin-top:12px;border-top:1px solid #e0e0e0;padding-top:12px">${signatureHtml}</div>` : "";
  const htmlBody = `<div>${escapedBody}</div>${sigBlock}${pixelTag}`;

  const headerLines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    "",
    htmlBody,
  ];

  const raw = Buffer.from(headerLines.join("\r\n")).toString("base64url");
  const res = await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
  return res.data.threadId ?? "";
}

export async function replyToThread(
  accessToken: string,
  refreshToken: string | null,
  threadId: string,
  to: string,
  subject: string,
  body: string,
  inReplyTo?: string,
  userEmail?: string,
  trackingPixelUrl?: string,
  signatureHtml?: string,
): Promise<void> {
  const client = userEmail
    ? createAuthenticatedClient(accessToken, refreshToken, userEmail)
    : (() => { const c = createOAuth2Client(); c.setCredentials({ access_token: accessToken, refresh_token: refreshToken }); return c; })();
  const gmail = google.gmail({ version: "v1", auth: client });

  const cleanSubject = subject.startsWith("Re: ") ? subject : `Re: ${subject}`;

  const escapedBody = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  const pixelTag = trackingPixelUrl
    ? `<img src="${trackingPixelUrl}" width="1" height="1" style="display:none" alt="" />`
    : "";
  const sigBlock = signatureHtml ? `<br><div style="margin-top:12px;border-top:1px solid #e0e0e0;padding-top:12px">${signatureHtml}</div>` : "";
  const htmlBody = `<div>${escapedBody}</div>${sigBlock}${pixelTag}`;

  const headerLines = [
    `To: ${to}`,
    `Subject: ${cleanSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=utf-8",
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`] : []),
    "",
    htmlBody,
  ];

  const raw = Buffer.from(headerLines.join("\r\n")).toString("base64url");
  await gmail.users.messages.send({ userId: "me", requestBody: { raw, threadId } });
}

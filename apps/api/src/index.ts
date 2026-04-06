import cors from "cors";
import { randomUUID } from "crypto";
import express from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getBuyerProfilesCollection, getBuyerSearchResultsCollection, getCompanyATSCollection, getCompaniesCollection, getGoogleTokensCollection, getInvitesCollection, getJobsCollection, getLegacyLinkedinContentForPersonCollection, getLinkedinPostsForUserCollection, getPersonsCollection, getSignalsCollection, getSkillsCollection, getTriggerJobsCollection, getTriggersCollection, getUsersCollection, getWorkspacesCollection } from "./db.js";
import { env } from "./env.js";
import { getEmailFromToken, signToken } from "./auth.js";
import { enrichCompanyByLinkedinId, enrichDomainWithFiber, enrichPersonByEmailWithFiber, enrichPersonWithFiber, findEmailWithContactDetails, findPersonEmailWithFiber, searchBuyersWithFiber } from "./fiber.js";
import { startTriggersWorker, scheduleTriggersCron, triggerTriggersProcessing, createPendingJobs, enqueuePendingJobsForUser, enqueueSpecificJob } from "./triggers-worker.js";
import { detectCompanyATS } from "./firecrawl.js";
import { exchangeCodeForTokens, getCalendarEvents, getEmailsWithPerson, getGoogleAuthUrl, getGoogleSigninUrl, getInboxThreads, getThreadMessages, getUserInfoFromGoogle, markThreadAsRead, replyToThread, sendGmail } from "./google.js";

const app = express();

const corsOptions: cors.CorsOptions = {
  origin: [
    "http://localhost:3000",
    "https://localhost:3000",
    "https://dev.sidr.ai",
    "https://sidr.ai",
    "https://gtmbench-web.vercel.app",
    "https://sidr-dev.vercel.app",
    "https://sidr-sigma.vercel.app",
  ],
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-api-key"],
};

app.use(cors(corsOptions));
app.options("/{*path}", cors(corsOptions));
app.use(express.json());

const createCompanySchema = z.object({
  domain: z.string().min(3).toLowerCase(),
});

const createBuyerProfileSchema = z.object({
  name: z.string().min(1, "Name is required"),
  titles: z.array(z.string().min(1)).min(1, "At least one title is required"),
});

const updateBuyerProfileSchema = z.object({
  name: z.string().min(1, "Name is required").optional(),
  titles: z.array(z.string().min(1)).min(1, "At least one title is required").optional(),
});

const createPersonSchema = z.object({
  linkedinUrl: z.string().url().refine(
    (url) => url.includes("linkedin.com/in/"),
    { message: "Must be a LinkedIn profile URL" },
  ),
  buyerProfileId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
});

function sanitizeDomain(rawDomain: string): string {
  return rawDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
}

/**
 * Extract top-level fields from a Fiber enrichment payload.
 * Returns workEmail and companyDomain (with email-domain fallback).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPersonFields(enrichmentPayload: any): { workEmail?: string; companyDomain?: string; companyName?: string; linkedinCompanyId?: string } {
  const personData = enrichmentPayload?.output?.data?.[0] ?? enrichmentPayload?.data?.[0] ?? enrichmentPayload?.output ?? null;
  if (!personData || typeof personData !== "object") return {};

  const workEmail: string | undefined =
    personData.work_email ?? personData.emails?.[0] ?? personData.personal_email ?? personData.email ?? undefined;

  // Try multiple paths to find current job / company info
  // First check current_job, then look in experiences array for is_current entries
  const currentExperience = Array.isArray(personData.experiences)
    ? personData.experiences.find((e: any) => e.is_current)
    : Array.isArray(personData.experience)
      ? personData.experience.find((e: any) => e.is_current || e.isCurrent)
      : undefined;

  const currentJob = personData.current_job ?? personData.current_position ?? currentExperience ?? undefined;

  let companyDomain: string | undefined =
    currentJob?.company_domain
    ?? currentJob?.company_website_domain
    ?? currentJob?.domain
    ?? personData.current_company_domain
    ?? personData.company_domain
    ?? undefined;

  // Try to extract domain from company website URL
  if (!companyDomain) {
    const companyUrl: string | undefined = currentJob?.company_website ?? currentJob?.company_url ?? currentJob?.website ?? personData.company_website ?? undefined;
    if (companyUrl) {
      try {
        companyDomain = new URL(companyUrl.startsWith("http") ? companyUrl : `https://${companyUrl}`).hostname.replace(/^www\./, "");
      } catch { /* ignore */ }
    }
  }

  if (companyDomain) companyDomain = sanitizeDomain(companyDomain);

  // Fallback: derive company domain from work email
  if (!companyDomain && workEmail) {
    const emailDomain = workEmail.split("@")[1];
    if (emailDomain && !["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"].includes(emailDomain)) {
      companyDomain = emailDomain;
    }
  }

  const companyName: string | undefined = currentJob?.company_name ?? personData.current_company_name ?? personData.company_name ?? undefined;
  const linkedinCompanyId: string | undefined = currentJob?.linkedin_company_id ?? undefined;

  return { workEmail, companyDomain, companyName, linkedinCompanyId };
}

/**
 * Extract display fields from a Fiber company enrichment payload.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractCompanyDisplayFields(enrichmentPayload: any): { domain?: string; name?: string; logo?: string; description?: string } {
  const companyData = enrichmentPayload?.output?.data?.[0] ?? enrichmentPayload?.data?.[0] ?? enrichmentPayload?.output ?? null;
  if (!companyData || typeof companyData !== "object") return {};

  let domain: string | undefined =
    companyData.domain
    ?? companyData.company_domain
    ?? companyData.website_domain
    ?? companyData.primary_domain
    ?? undefined;

  // Fiber returns `domains` as an array — use the first one
  if (!domain && Array.isArray(companyData.domains) && companyData.domains.length > 0) {
    const first = companyData.domains[0];
    domain = typeof first === "string" ? first : first?.domain ?? first?.value ?? undefined;
  }

  // Fiber returns `websites` as an array — extract domain from first URL
  if (!domain && Array.isArray(companyData.websites) && companyData.websites.length > 0) {
    const first = companyData.websites[0];
    const urlStr = typeof first === "string" ? first : first?.url ?? first?.value ?? undefined;
    if (urlStr) {
      try { domain = new URL(urlStr.startsWith("http") ? urlStr : `https://${urlStr}`).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
    }
  }

  // Try singular website field
  if (!domain) {
    const website: string | undefined = companyData.website ?? companyData.company_website ?? companyData.homepage_url ?? companyData.url ?? undefined;
    if (website) {
      try { domain = new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, ""); } catch { /* ignore */ }
    }
  }

  if (domain) domain = sanitizeDomain(domain);

  return {
    domain,
    name: companyData.preferred_name ?? companyData.name ?? companyData.company_name ?? undefined,
    logo: companyData.logo_url ?? companyData.logo ?? companyData.profile_pic ?? companyData.profile_pic_url ?? undefined,
    description: companyData.short_description ?? companyData.description ?? companyData.li_description ?? companyData.tagline ?? undefined,
  };
}

/**
 * Ensure a company record exists for the given domain, creating + enriching it if needed.
 * Returns the ObjectId of the company (existing or newly created).
 */
async function ensureCompany(domain: string, userEmail: string): Promise<ObjectId> {
  const companiesCol = await getCompaniesCollection();
  const existing = await companiesCol.findOne({ domain });
  if (existing) {
    await companiesCol.updateOne({ _id: existing._id }, { $addToSet: { userEmails: userEmail } });
    return existing._id!;
  }
  const ins = await companiesCol.insertOne({
    userEmails: [userEmail],
    domain,
    createdAt: new Date().toISOString(),
    enrichmentStatus: "pending",
  });
  const companyId = ins.insertedId;
  const companyEnrichment = await enrichDomainWithFiber(domain);
  if (companyEnrichment.success) {
    await companiesCol.updateOne({ _id: companyId }, {
      $set: { enrichedAt: new Date().toISOString(), enrichmentStatus: "completed", enrichmentData: companyEnrichment.payload },
    });
  } else {
    await companiesCol.updateOne({ _id: companyId }, {
      $set: { enrichedAt: new Date().toISOString(), enrichmentStatus: "failed", enrichmentError: companyEnrichment.error ?? "Fiber enrichment failed", enrichmentData: companyEnrichment.payload },
    });
  }
  return companyId;
}

/**
 * Return all member emails for the workspace that userEmail belongs to.
 * Falls back to [userEmail] if the user has no workspace.
 */
async function getWorkspaceMemberEmails(userEmail: string): Promise<string[]> {
  const usersCol = await getUsersCollection();
  const user = await usersCol.findOne({ email: userEmail });
  if (!user?.workspaceId) return [userEmail];
  const members = await usersCol.find({ workspaceId: user.workspaceId }).toArray();
  const emails = members.map((m) => m.email);
  // Always include the requester even if somehow not in the list
  if (!emails.includes(userEmail)) emails.push(userEmail);
  return emails;
}

function getBearerToken(headerValue?: string): string | null {
  if (!headerValue) return null;
  const [scheme, token] = headerValue.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

// Public — return Google OAuth URL for sign-in (basic scopes only — no gmail/calendar)
app.get("/auth/google/signin-url", (request, response) => {
  const returnPath = (request.query.returnPath as string) || "/dashboard";
  const inviteToken = (request.query.inviteToken as string) || null;
  const state = Buffer.from(JSON.stringify({ mode: "signin", returnPath, inviteToken })).toString("base64");
  const url = getGoogleSigninUrl(state);
  response.json({ url });
});

// Public — Google OAuth callback (handles both sign-in and account-connect modes)
app.get("/auth/google/callback", async (request, response) => {
  const { code, state } = request.query as { code?: string; state?: string };

  if (!code || !state) {
    response.status(400).send("Missing code or state");
    return;
  }

  let mode: string;
  let userEmail: string | undefined;
  let returnPath: string;
  let inviteToken: string | null;
  try {
    const decoded = JSON.parse(Buffer.from(state, "base64").toString("utf8"));
    mode = decoded.mode ?? "connect";
    userEmail = decoded.userEmail;
    returnPath = decoded.returnPath ?? "/dashboard";
    inviteToken = decoded.inviteToken ?? null;
  } catch {
    response.status(400).send("Invalid state");
    return;
  }

  try {
    const tokens = await exchangeCodeForTokens(code);

    if (mode === "signin") {
      // Get real email from Google
      const googleInfo = await getUserInfoFromGoogle(tokens.access_token!, tokens.refresh_token ?? null);
      const email = googleInfo.email.toLowerCase();

      // Store Google tokens
      const googleTokensCol = await getGoogleTokensCollection();
      await googleTokensCol.updateOne(
        { userEmail: email },
        {
          $set: {
            userEmail: email,
            accessToken: tokens.access_token!,
            refreshToken: tokens.refresh_token ?? null,
            expiryDate: tokens.expiry_date ?? null,
            scope: tokens.scope ?? null,
            updatedAt: new Date().toISOString(),
          },
        },
        { upsert: true },
      );

      // Upsert user record — auto-populate name/photo from Google on first sign-in
      const usersCol = await getUsersCollection();
      const now = new Date().toISOString();
      const existingUser = await usersCol.findOne({ email });
      if (!existingUser) {
        await usersCol.insertOne({
          email,
          fullName: googleInfo.name ?? null,
          profilePhotoUrl: googleInfo.picture ?? null,
          role: "admin",
          onboardingComplete: false,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        // Update photo/name from Google if not already set
        const updates: Record<string, unknown> = { updatedAt: now };
        if (!existingUser.fullName && googleInfo.name) updates.fullName = googleInfo.name;
        if (!existingUser.profilePhotoUrl && googleInfo.picture) updates.profilePhotoUrl = googleInfo.picture;
        await usersCol.updateOne({ email }, { $set: updates });
      }

      const user = await usersCol.findOne({ email });
      const jwt = signToken(email);

      // Redirect to frontend with token
      const params = new URLSearchParams({
        token: jwt,
        onboardingComplete: String(user?.onboardingComplete ?? false),
        ...(inviteToken ? { invite: inviteToken } : {}),
      });
      response.redirect(`${env.APP_URL}/auth/callback?${params.toString()}`);
    } else {
      // "connect" mode — add another Google account to the workspace
      if (!userEmail) {
        response.status(400).send("Missing userEmail for connect mode");
        return;
      }

      // Get email from Google to know which account was connected
      const googleInfo = await getUserInfoFromGoogle(tokens.access_token!, tokens.refresh_token ?? null);
      const connectedEmail = googleInfo.email.toLowerCase();

      const googleTokensCol = await getGoogleTokensCollection();
      await googleTokensCol.updateOne(
        { userEmail: connectedEmail },
        {
          $set: {
            userEmail: connectedEmail,
            accessToken: tokens.access_token!,
            refreshToken: tokens.refresh_token ?? null,
            expiryDate: tokens.expiry_date ?? null,
            scope: tokens.scope ?? null,
            updatedAt: new Date().toISOString(),
          },
        },
        { upsert: true },
      );

      // Mark gmail & calendar as connected on the user record
      const usersColConnect = await getUsersCollection();
      await usersColConnect.updateOne(
        { email: userEmail.toLowerCase() },
        { $set: { gmailConnected: true, calendarConnected: true, updatedAt: new Date().toISOString() } },
      );

      response.redirect(`${env.APP_URL}${returnPath}?gmail=connected`);
    }
  } catch (err) {
    console.error("[google-callback] Failed:", err);
    if (mode === "signin") {
      response.redirect(`${env.APP_URL}/auth/callback?error=google_auth_failed`);
    } else {
      response.redirect(`${env.APP_URL}${returnPath}?gmail=error`);
    }
  }
});

// Public: look up an invite by token (used on onboarding page before login)
app.get("/invite/:token", async (request, response) => {
  const invitesCol = await getInvitesCollection();
  const invite = await invitesCol.findOne({ token: request.params.token, status: "pending" });
  if (!invite) {
    response.status(404).json({ error: "Invite not found or expired" });
    return;
  }
  if (new Date(invite.expiresAt) < new Date()) {
    response.status(410).json({ error: "Invite has expired" });
    return;
  }
  const workspacesCol = await getWorkspacesCollection();
  const workspace = await workspacesCol.findOne({ _id: invite.workspaceId });
  response.json({ invite, workspace });
});

/* ------------------------------------------------------------------ */
/*  Health endpoint (no auth required)                                   */
/* ------------------------------------------------------------------ */

app.get("/health", (_request, response) => {
  response.json({ status: "ok", timestamp: new Date().toISOString() });
});

/* ------------------------------------------------------------------ */
/*  Cron endpoint (Vercel Cron Jobs) — before auth middleware            */
/* ------------------------------------------------------------------ */

app.get("/cron/run-triggers", async (request, response) => {
  const secret = request.header("authorization")?.replace("Bearer ", "");
  if (!env.CRON_SECRET || secret !== env.CRON_SECRET) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  console.log("[cron] /cron/run-triggers invoked");
  try {
    // 1. Create any new pending jobs for active triggers
    const usersCol = await getUsersCollection();
    const allUsers = await usersCol.find({}).toArray();
    for (const user of allUsers) {
      try {
        await createPendingJobs(user.email);
      } catch (err) {
        console.error(`[cron] createPendingJobs failed for ${user.email}:`, err);
      }
    }

    // 2. Enqueue all pending jobs for processing
    const enqueued = await triggerTriggersProcessing();
    console.log("[cron] Enqueued %d jobs", enqueued);
    response.json({ ok: true, enqueued });
  } catch (err) {
    console.error("[cron] run-triggers error:", err);
    response.status(500).json({ error: "Cron job failed" });
  }
});

app.use((request, response, next) => {
  // Skip auth for preflight requests — CORS middleware already handled them
  if (request.method === "OPTIONS") {
    next();
    return;
  }

  console.log("[auth-middleware] %s %s", request.method, request.path);

  // Validate API key if configured
  if (env.API_KEY) {
    const clientKey = request.header("x-api-key");
    if (clientKey !== env.API_KEY) {
      response.status(403).json({ error: "Invalid API key" });
      return;
    }
  }

  console.log("[auth-middleware] Authorization header:", request.header("authorization")?.substring(0, 30) + "...");

  const token = getBearerToken(request.header("authorization"));
  if (!token) {
    console.error("[auth-middleware] No bearer token found in header");
    response.status(401).json({ error: "Missing auth token" });
    return;
  }

  console.log("[auth-middleware] Extracted token (first 20 chars):", token.substring(0, 20) + "...");

  const email = getEmailFromToken(token);
  if (!email) {
    console.error("[auth-middleware] getEmailFromToken returned null — token is invalid");
    response.status(401).json({ error: "Invalid token" });
    return;
  }

  console.log("[auth-middleware] Authenticated user:", email);
  response.locals.userEmail = email;
  next();
});

app.get("/me", async (_request, response) => {
  const email = response.locals.userEmail as string;
  const usersCol = await getUsersCollection();
  const user = await usersCol.findOne({ email });
  if (!user) {
    // Legacy: user exists via JWT but no UserRecord yet — return minimal profile
    response.json({ email, onboardingComplete: false });
    return;
  }
  let workspace = null;
  if (user.workspaceId) {
    const workspacesCol = await getWorkspacesCollection();
    workspace = await workspacesCol.findOne({ _id: user.workspaceId });
  }
  response.json({ email, user, workspace, onboardingComplete: user.onboardingComplete });
});

app.put("/me", async (request, response) => {
  const email = response.locals.userEmail as string;
  const { fullName, profilePhotoUrl, shareWithWorkspace } = request.body as {
    fullName?: string;
    profilePhotoUrl?: string;
    shareWithWorkspace?: boolean;
  };
  const usersCol = await getUsersCollection();
  const now = new Date().toISOString();
  await usersCol.updateOne(
    { email },
    {
      $set: {
        ...(fullName !== undefined ? { fullName } : {}),
        ...(profilePhotoUrl !== undefined ? { profilePhotoUrl } : {}),
        ...(shareWithWorkspace !== undefined ? { shareWithWorkspace } : {}),
        updatedAt: now,
      },
    },
  );
  const user = await usersCol.findOne({ email });
  response.json({ user });
});

/* ------------------------------------------------------------------ */
/*  Workspace lookup (by domain)                                       */
/* ------------------------------------------------------------------ */

app.get("/workspace/lookup", async (request, response) => {
  const domain = (request.query.domain as string | undefined)?.toLowerCase().trim();
  if (!domain) {
    response.status(400).json({ error: "domain query param required" });
    return;
  }
  const workspacesCol = await getWorkspacesCollection();
  const workspace = await workspacesCol.findOne({ domain });
  response.json({ workspace: workspace ?? null });
});

app.get("/workspace", async (_request, response) => {
  const email = response.locals.userEmail as string;
  const usersCol = await getUsersCollection();
  const user = await usersCol.findOne({ email });
  if (!user?.workspaceId) {
    response.json({ workspace: null });
    return;
  }
  const workspacesCol = await getWorkspacesCollection();
  const workspace = await workspacesCol.findOne({ _id: user.workspaceId });
  response.json({ workspace: workspace ?? null });
});

app.put("/workspace", async (request, response) => {
  const email = response.locals.userEmail as string;
  const usersCol = await getUsersCollection();
  const user = await usersCol.findOne({ email });
  if (!user?.workspaceId) {
    response.status(404).json({ error: "No workspace found" });
    return;
  }
  const { name, logoUrl, websiteUrl, description } = request.body as {
    name?: string; logoUrl?: string; websiteUrl?: string; description?: string;
  };
  const workspacesCol = await getWorkspacesCollection();
  const now = new Date().toISOString();
  await workspacesCol.updateOne(
    { _id: user.workspaceId },
    { $set: { ...(name ? { name } : {}), ...(logoUrl !== undefined ? { logoUrl } : {}), ...(websiteUrl !== undefined ? { websiteUrl } : {}), ...(description !== undefined ? { description } : {}), updatedAt: now } },
  );
  const workspace = await workspacesCol.findOne({ _id: user.workspaceId });
  response.json({ workspace });
});

app.get("/workspace/members", async (_request, response) => {
  const email = response.locals.userEmail as string;
  const usersCol = await getUsersCollection();
  const user = await usersCol.findOne({ email });
  if (!user?.workspaceId) {
    response.json({ members: [] });
    return;
  }
  const members = await usersCol.find({ workspaceId: user.workspaceId }).toArray();
  response.json({ members });
});

// Create an invite link for the workspace
app.post("/workspace/invite", async (_request, response) => {
  const email = response.locals.userEmail as string;
  const usersCol = await getUsersCollection();
  const user = await usersCol.findOne({ email });
  if (!user?.workspaceId) {
    response.status(400).json({ error: "You don't have a workspace" });
    return;
  }
  const invitesCol = await getInvitesCollection();
  const token = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await invitesCol.insertOne({
    workspaceId: user.workspaceId,
    invitedByEmail: email,
    email: null,
    token,
    status: "pending",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  const workspacesCol = await getWorkspacesCollection();
  const workspace = await workspacesCol.findOne({ _id: user.workspaceId });
  response.json({ token, workspace });
});

// Get pending invites for the workspace
app.get("/workspace/invites", async (_request, response) => {
  const email = response.locals.userEmail as string;
  const usersCol = await getUsersCollection();
  const user = await usersCol.findOne({ email });
  if (!user?.workspaceId) {
    response.json({ invites: [] });
    return;
  }
  const invitesCol = await getInvitesCollection();
  const invites = await invitesCol
    .find({ workspaceId: user.workspaceId, status: "pending" })
    .sort({ createdAt: -1 })
    .toArray();
  response.json({ invites });
});

// Revoke an invite
app.delete("/workspace/invites/:token", async (request, response) => {
  const email = response.locals.userEmail as string;
  const usersCol = await getUsersCollection();
  const user = await usersCol.findOne({ email });
  if (!user?.workspaceId) {
    response.status(404).json({ error: "Not found" });
    return;
  }
  const invitesCol = await getInvitesCollection();
  await invitesCol.deleteOne({ token: request.params.token, workspaceId: user.workspaceId });
  response.json({ ok: true });
});

// Accept an invite (for users who have already completed onboarding)
app.post("/workspace/accept-invite", async (request, response) => {
  const email = response.locals.userEmail as string;
  const { inviteToken } = request.body as { inviteToken?: string };
  if (!inviteToken) {
    response.status(400).json({ error: "Missing invite token" });
    return;
  }
  const invitesCol = await getInvitesCollection();
  const invite = await invitesCol.findOne({ token: inviteToken, status: "pending" });
  if (!invite || new Date(invite.expiresAt) < new Date()) {
    response.status(400).json({ error: "Invite is invalid or expired" });
    return;
  }
  const usersCol = await getUsersCollection();
  const now = new Date().toISOString();
  await usersCol.updateOne(
    { email },
    { $set: { workspaceId: invite.workspaceId, role: "admin" as const, updatedAt: now } },
  );
  await invitesCol.updateOne({ _id: invite._id }, { $set: { status: "accepted" } });
  const workspacesCol = await getWorkspacesCollection();
  const workspace = await workspacesCol.findOne({ _id: invite.workspaceId });
  response.json({ ok: true, workspace });
});

/* ------------------------------------------------------------------ */
/*  Onboarding completion                                              */
/* ------------------------------------------------------------------ */

app.post("/onboarding/complete", async (request, response) => {
  const email = response.locals.userEmail as string;
  const {
    fullName,
    profilePhotoUrl,
    workspaceName,
    workspaceDomain,
    workspaceLogoUrl,
    workspaceWebsiteUrl,
    workspaceDescription,
    joinExistingWorkspaceId,
    inviteToken,
  } = request.body as {
    fullName?: string;
    profilePhotoUrl?: string;
    workspaceName?: string;
    workspaceDomain?: string;
    workspaceLogoUrl?: string;
    workspaceWebsiteUrl?: string;
    workspaceDescription?: string;
    joinExistingWorkspaceId?: string;
    inviteToken?: string;
  };

  const usersCol = await getUsersCollection();
  const workspacesCol = await getWorkspacesCollection();
  const now = new Date().toISOString();

  let workspaceId;
  let isInvited = false;

  if (inviteToken) {
    // Join via invite link
    const invitesCol = await getInvitesCollection();
    const invite = await invitesCol.findOne({ token: inviteToken, status: "pending" });
    if (!invite || new Date(invite.expiresAt) < new Date()) {
      response.status(400).json({ error: "Invite is invalid or expired" });
      return;
    }
    workspaceId = invite.workspaceId;
    isInvited = true;
    // Mark invite accepted
    await invitesCol.updateOne({ _id: invite._id }, { $set: { status: "accepted" } });
  } else if (joinExistingWorkspaceId) {
    // Join an existing workspace
    try {
      workspaceId = new ObjectId(joinExistingWorkspaceId);
    } catch {
      response.status(400).json({ error: "Invalid workspace ID" });
      return;
    }
  } else if (workspaceName && workspaceDomain) {
    // Create a new workspace (or find existing by domain)
    const domain = sanitizeDomain(workspaceDomain).toLowerCase();
    const existing = await workspacesCol.findOne({ domain });
    if (existing) {
      workspaceId = existing._id;
    } else {
      const insertResult = await workspacesCol.insertOne({
        name: workspaceName,
        domain,
        logoUrl: workspaceLogoUrl ?? null,
        websiteUrl: workspaceWebsiteUrl ?? null,
        description: workspaceDescription ?? null,
        createdAt: now,
        updatedAt: now,
      });
      workspaceId = insertResult.insertedId;
    }
  }

  await usersCol.updateOne(
    { email },
    {
      $set: {
        ...(fullName ? { fullName } : {}),
        ...(profilePhotoUrl !== undefined ? { profilePhotoUrl } : {}),
        ...(workspaceId ? { workspaceId, role: "admin" as const } : {}),
        onboardingComplete: true,
        updatedAt: now,
      },
    },
  );

  const user = await usersCol.findOne({ email });
  const workspace = workspaceId ? await workspacesCol.findOne({ _id: workspaceId }) : null;
  response.json({ user, workspace });
});

app.get("/companies", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const companiesCollection = await getCompaniesCollection();
  const companies = await companiesCollection.find({ userEmails: { $in: memberEmails } }).sort({ createdAt: -1 }).toArray();
  response.json({ companies });
});

app.get("/companies/by-domain/:domain", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const companiesCollection = await getCompaniesCollection();
  const company = await companiesCollection.findOne({ domain: request.params.domain, userEmails: { $in: memberEmails } });
  if (!company) {
    response.status(404).json({ error: "Company not found" });
    return;
  }
  response.json({ company });
});

app.get("/companies/:id", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const companiesCollection = await getCompaniesCollection();
  let company;
  try {
    company = await companiesCollection.findOne({ _id: new ObjectId(request.params.id), userEmails: { $in: memberEmails } });
  } catch {
    response.status(400).json({ error: "Invalid company ID" });
    return;
  }
  if (!company) {
    response.status(404).json({ error: "Company not found" });
    return;
  }
  response.json({ company });
});

app.get("/companies/:id/persons", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const companiesCollection = await getCompaniesCollection();
  let company;
  try {
    company = await companiesCollection.findOne({ _id: new ObjectId(request.params.id), userEmails: { $in: memberEmails } });
  } catch {
    response.status(400).json({ error: "Invalid company ID" });
    return;
  }
  if (!company) {
    response.status(404).json({ error: "Company not found" });
    return;
  }
  const personsCollection = await getPersonsCollection();
  const persons = await personsCollection.find({
    $or: [
      { companyDomain: company.domain },
      { companyId: company._id },
    ],
    userEmails: { $in: memberEmails },
  }).sort({ createdAt: -1 }).toArray();
  response.json({ persons });
});

/* ------------------------------------------------------------------ */
/*  Preview company + search buyers (does NOT save)                      */
/* ------------------------------------------------------------------ */

app.post("/companies/preview", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const { domain: rawDomain } = request.body as { domain?: string };

  if (!rawDomain) {
    response.status(400).json({ error: "domain is required" });
    return;
  }

  const domain = sanitizeDomain(rawDomain);

  try {
    // Enrich company
    const companyResult = await enrichDomainWithFiber(domain);
    const companyPayload = companyResult.success ? companyResult.payload : undefined;
    const companyDisplay = companyPayload ? extractCompanyDisplayFields(companyPayload) : { domain, name: domain };

    // Find default buyer profile
    const memberEmails = await getWorkspaceMemberEmails(userEmail);
    const profilesCol = await getBuyerProfilesCollection();
    const profiles = await profilesCol.find({ userEmail: { $in: memberEmails } }).sort({ createdAt: -1 }).toArray();
    const defaultProfile = profiles.find((p: any) => p.isDefault) ?? profiles[0] ?? null;

    let buyers: any[] = [];
    let buyerProfileId: string | null = null;
    let buyerProfileName: string | null = null;

    if (defaultProfile) {
      buyerProfileId = defaultProfile._id!.toHexString();
      buyerProfileName = defaultProfile.name ?? null;
      // Search for buyers using the default profile
      console.log(`[company-preview] Searching buyers for domain=${domain} with profile=${defaultProfile.name} titles=${JSON.stringify(defaultProfile.titles)}`);
      const buyerResult = await searchBuyersWithFiber(domain, defaultProfile.titles);
      if (buyerResult.success) {
        const payload = buyerResult.payload as any;
        const rawBuyers = (payload?.output?.data ?? []) as any[];
        buyers = rawBuyers.map((b: any) => ({
          name: b.name ?? `${b.first_name ?? ""} ${b.last_name ?? ""}`.trim(),
          title: b.headline ?? b.current_job?.title ?? undefined,
          profilePic: b.profile_pic ?? undefined,
          linkedinUrl: b.url ?? b.linkedin_url ?? (b.primary_slug ? `https://www.linkedin.com/in/${b.primary_slug}` : undefined),
          workEmail: b.work_email ?? undefined,
          _raw: b,
        }));
        console.log(`[company-preview] Found ${buyers.length} buyers`);
      }
    }

    response.json({
      company: companyDisplay,
      buyers,
      buyerProfileId,
      buyerProfileName,
      _enrichment: {
        companyPayload,
        domain,
      },
    });
  } catch (err) {
    console.error("[company-preview] Error:", err);
    response.status(500).json({ error: "Failed to preview company" });
  }
});

/* ------------------------------------------------------------------ */
/*  Confirm adding a company + selected buyers                          */
/* ------------------------------------------------------------------ */

app.post("/companies/confirm", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const { domain, companyPayload, buyerProfileId, selectedBuyers } = request.body as {
    domain?: string;
    companyPayload?: any;
    buyerProfileId?: string;
    selectedBuyers?: { linkedinUrl: string; workEmail?: string; _raw?: any }[];
  };

  if (!domain) {
    response.status(400).json({ error: "domain is required" });
    return;
  }

  try {
    // Create or link company
    const companiesCol = await getCompaniesCollection();
    const memberEmails = await getWorkspaceMemberEmails(userEmail);
    const existingCompany = await companiesCol.findOne({ domain });

    let companyId: ObjectId;
    if (existingCompany) {
      await companiesCol.updateOne({ _id: existingCompany._id }, { $addToSet: { userEmails: userEmail } });
      companyId = existingCompany._id!;
      // If existing but no enrichment data, update with new payload
      if (companyPayload && !existingCompany.enrichmentData) {
        await companiesCol.updateOne({ _id: companyId }, {
          $set: { enrichedAt: new Date().toISOString(), enrichmentStatus: "completed", enrichmentData: companyPayload },
        });
      }
    } else if (companyPayload) {
      const ins = await companiesCol.insertOne({
        userEmails: [userEmail],
        domain,
        createdAt: new Date().toISOString(),
        enrichedAt: new Date().toISOString(),
        enrichmentStatus: "completed",
        enrichmentData: companyPayload,
      });
      companyId = ins.insertedId;
    } else {
      companyId = await ensureCompany(domain, userEmail);
    }

    // Add selected buyers as persons
    let addedCount = 0;
    if (selectedBuyers && selectedBuyers.length > 0) {
      const personsCol = await getPersonsCollection();
      const now = new Date().toISOString();
      const buyerProfileObjectId = buyerProfileId ? new ObjectId(buyerProfileId) : undefined;

      await Promise.all(
        selectedBuyers.map(async (buyer) => {
          if (!buyer.linkedinUrl) return;
          let linkedinUrl: string;
          try { linkedinUrl = normalizeLinkedinUrl(buyer.linkedinUrl); } catch { return; }

          // Build enrichment data wrapper if we have raw Fiber data
          const hasRaw = buyer._raw && typeof buyer._raw === "object";
          const enrichmentData = hasRaw ? { output: { data: [buyer._raw] } } : undefined;

          const result = await personsCol.updateOne(
            { linkedinUrl },
            {
              $setOnInsert: {
                linkedinUrl,
                createdAt: now,
              },
              $addToSet: { userEmails: userEmail },
              $set: {
                companyId,
                companyDomain: domain,
                ...(buyerProfileObjectId ? { buyerProfileId: buyerProfileObjectId } : {}),
                ...(buyer.workEmail ? { workEmail: buyer.workEmail } : {}),
                ...(hasRaw ? {
                  enrichmentStatus: "completed",
                  enrichedAt: now,
                  enrichmentData,
                } : {}),
              },
            },
            { upsert: true },
          );
          if (result.upsertedCount > 0 || result.modifiedCount > 0) addedCount++;
        }),
      );
    }

    const savedCompany = await companiesCol.findOne({ _id: companyId });
    response.status(201).json({ company: savedCompany, buyersAdded: addedCount });
  } catch (err) {
    console.error("[confirm-company] Error:", err);
    response.status(500).json({ error: "Failed to add company" });
  }
});

app.post("/companies", async (request, response) => {
  const parsed = createCompanySchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Please provide a valid domain" });
    return;
  }

  const userEmail = response.locals.userEmail as string;
  const domain = sanitizeDomain(parsed.data.domain);
  const companiesCollection = await getCompaniesCollection();

  const createCompanyMemberEmails = await getWorkspaceMemberEmails(userEmail);
  // Check if this user already has this company
  const existingForUser = await companiesCollection.findOne({ domain, userEmails: { $in: createCompanyMemberEmails } });
  if (existingForUser) {
    response.status(409).json({ error: "Company already exists", company: existingForUser });
    return;
  }

  // Check if the company exists but belongs to other users — just add the association
  const existingCompany = await companiesCollection.findOne({ domain });
  if (existingCompany) {
    await companiesCollection.updateOne(
      { _id: existingCompany._id },
      { $addToSet: { userEmails: userEmail } },
    );
    // Backfill companyId on persons with matching domain that are missing it
    const personsCol = await getPersonsCollection();
    await personsCol.updateMany(
      { companyDomain: domain, companyId: { $exists: false } },
      { $set: { companyId: existingCompany._id! } },
    );
    const updatedCompany = await companiesCollection.findOne({ _id: existingCompany._id });
    response.status(201).json({ company: updatedCompany });
    return;
  }

  // New domain — create company and enrich
  const createdAt = new Date().toISOString();
  const insertResult = await companiesCollection.insertOne({
    userEmails: [userEmail],
    domain,
    createdAt,
    enrichmentStatus: "pending",
  });

  const companyId = insertResult.insertedId;
  const enrichment = await enrichDomainWithFiber(domain);

  if (enrichment.success) {
    await companiesCollection.updateOne(
      { _id: companyId },
      {
        $set: {
          enrichedAt: new Date().toISOString(),
          enrichmentStatus: "completed",
          enrichmentData: enrichment.payload,
        },
      },
    );
  } else {
    await companiesCollection.updateOne(
      { _id: companyId },
      {
        $set: {
          enrichedAt: new Date().toISOString(),
          enrichmentStatus: "failed",
          enrichmentError: enrichment.error ?? "Fiber enrichment failed",
          enrichmentData: enrichment.payload,
        },
      },
    );
  }

  // Backfill companyId on persons with matching domain that are missing it
  {
    const personsCol = await getPersonsCollection();
    await personsCol.updateMany(
      { companyDomain: domain, companyId: { $exists: false } },
      { $set: { companyId } },
    );
  }

  const savedCompany = await companiesCollection.findOne({ _id: companyId });
  response.status(201).json({ company: savedCompany });
});

app.delete("/companies/:id", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const companiesCollection = await getCompaniesCollection();

  let result;
  try {
    result = await companiesCollection.updateOne(
      { _id: new ObjectId(request.params.id), userEmails: { $in: memberEmails } },
      { $pull: { userEmails: { $in: memberEmails } } },
    );
  } catch {
    response.status(400).json({ error: "Invalid company ID" });
    return;
  }

  if (result.matchedCount === 0) {
    response.status(404).json({ error: "Company not found" });
    return;
  }

  response.json({ success: true });
});

/* ------------------------------------------------------------------ */
/*  Person endpoints                                                    */
/* ------------------------------------------------------------------ */

function normalizeLinkedinUrl(raw: string): string {
  // Strip trailing slashes and query params to get a canonical form
  const url = new URL(raw);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

app.get("/persons", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const personsCollection = await getPersonsCollection();
  const persons = await personsCollection.find({ userEmails: { $in: memberEmails } }).sort({ createdAt: -1 }).toArray();
  response.json({ persons });
});

app.get("/persons/:id", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const personsCollection = await getPersonsCollection();
  let person;
  try {
    person = await personsCollection.findOne({ _id: new ObjectId(request.params.id), userEmails: { $in: memberEmails } });
  } catch {
    response.status(400).json({ error: "Invalid person ID" });
    return;
  }
  if (!person) {
    response.status(404).json({ error: "Person not found" });
    return;
  }
  response.json({ person });
});

/* ------------------------------------------------------------------ */
/*  Preview person + company enrichment (does NOT save)                  */
/* ------------------------------------------------------------------ */

app.post("/persons/preview", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const { linkedinUrl: rawUrl, email: rawEmail } = request.body as { linkedinUrl?: string; email?: string };

  const isEmail = !!rawEmail && !rawUrl;

  try {
    let personEnrichment: any;
    let linkedinUrl: string | undefined;
    let resolvedWorkEmail: string | undefined;

    if (isEmail) {
      // Email-based enrichment
      const workEmail = rawEmail!.trim().toLowerCase();
      const fiberResult = await enrichPersonByEmailWithFiber(workEmail);
      personEnrichment = fiberResult.payload;
      resolvedWorkEmail = workEmail;
      if (fiberResult.success && personEnrichment) {
        const personData = personEnrichment?.output?.data?.[0];
        linkedinUrl = personData?.linkedin_url ?? personData?.linkedinUrl ?? personData?.linkedin ?? undefined;
        if (linkedinUrl) {
          linkedinUrl = normalizeLinkedinUrl(linkedinUrl);
          // Do full kitchen-sink enrichment for richer data
          const kitchenSink = await enrichPersonWithFiber(linkedinUrl);
          if (kitchenSink.success && kitchenSink.payload) personEnrichment = kitchenSink.payload;
        }
      }
    } else {
      // LinkedIn-based enrichment
      linkedinUrl = rawUrl?.startsWith("http") ? rawUrl : `https://www.linkedin.com/in/${rawUrl}`;
      linkedinUrl = normalizeLinkedinUrl(linkedinUrl);
      const enrichment = await enrichPersonWithFiber(linkedinUrl);
      if (!enrichment.success) {
        response.status(422).json({ error: "Could not enrich this person" });
        return;
      }
      personEnrichment = enrichment.payload;
    }

    // Extract person display info
    const personData = personEnrichment?.output?.data?.[0];
    const { workEmail: extractedEmail, companyDomain, companyName, linkedinCompanyId } = extractPersonFields(personEnrichment ?? {});

    const personPreview = {
      name: personData ? `${personData.first_name ?? ""} ${personData.last_name ?? ""}`.trim() : undefined,
      title: personData?.headline ?? undefined,
      profilePic: personData?.profile_pic ?? undefined,
      linkedinUrl,
      workEmail: resolvedWorkEmail ?? extractedEmail,
      companyName,
      companyDomain,
      linkedinCompanyId,
    };

    // Enrich company — try multiple strategies
    let companyPreview: { domain?: string; name?: string; logo?: string; description?: string } | null = null;
    let companyEnrichmentPayload: any = null;

    // Strategy 1: Use LinkedIn company ID from experiences
    if (linkedinCompanyId) {
      console.log(`[preview] Enriching company by LinkedIn ID: ${linkedinCompanyId}, companyName: ${companyName ?? "none"}`);
      const companyResult = await enrichCompanyByLinkedinId(linkedinCompanyId, companyName);
      console.log(`[preview] Company by LinkedIn ID success=${companyResult.success}`);
      if (companyResult.success && companyResult.payload) {
        companyEnrichmentPayload = companyResult.payload;
        const fields = extractCompanyDisplayFields(companyResult.payload);
        console.log(`[preview] Extracted company fields: domain=${fields.domain}, name=${fields.name}`);
        companyPreview = fields;
        if (fields.domain) personPreview.companyDomain = fields.domain;
        if (fields.name && !personPreview.companyName) personPreview.companyName = fields.name;
      }
    }

    // Strategy 2: If we have a domain (from person enrichment or strategy 1), enrich by domain
    if (!companyEnrichmentPayload && companyDomain) {
      console.log(`[preview] Enriching company by domain: ${companyDomain}`);
      const companyResult = await enrichDomainWithFiber(companyDomain);
      if (companyResult.success && companyResult.payload) {
        companyEnrichmentPayload = companyResult.payload;
        companyPreview = extractCompanyDisplayFields(companyResult.payload);
      } else {
        companyPreview = { domain: companyDomain, name: companyName };
      }
    }

    // Strategy 3: If we still have no domain but have a company name, try using it as a domain hint
    if (!personPreview.companyDomain && companyName) {
      // Try guessing domain from company name (e.g. "Acme Inc" → "acme.com")
      const guessedDomain = companyName.toLowerCase().replace(/[^a-z0-9]/g, "") + ".com";
      console.log(`[preview] No domain found. Trying guessed domain from company name: ${guessedDomain}`);
      const companyResult = await enrichDomainWithFiber(guessedDomain);
      if (companyResult.success && companyResult.payload) {
        const fields = extractCompanyDisplayFields(companyResult.payload);
        // Only use if the enrichment actually resolved to a real company
        if (fields.name) {
          companyEnrichmentPayload = companyResult.payload;
          companyPreview = fields;
          if (fields.domain) personPreview.companyDomain = fields.domain;
          if (fields.name && !personPreview.companyName) personPreview.companyName = fields.name;
          console.log(`[preview] Guessed domain resolved: domain=${fields.domain}, name=${fields.name}`);
        }
      }
    }

    // If we still have no enrichment payload but have display info, keep the preview
    if (!companyPreview && (personPreview.companyDomain || personPreview.companyName)) {
      companyPreview = { domain: personPreview.companyDomain, name: personPreview.companyName };
    }

    // Final domain resolution: use companyPreview.domain as fallback
    const finalCompanyDomain = personPreview.companyDomain ?? companyPreview?.domain ?? undefined;
    if (finalCompanyDomain) personPreview.companyDomain = finalCompanyDomain;

    // Log raw company data keys for debugging
    if (companyEnrichmentPayload) {
      console.log(`[preview] Company payload top-level keys: ${JSON.stringify(Object.keys(companyEnrichmentPayload ?? {}))}`);
      console.log(`[preview] Company payload.output keys: ${JSON.stringify(Object.keys(companyEnrichmentPayload?.output ?? {}))}`);
      const outputData = companyEnrichmentPayload?.output?.data;
      console.log(`[preview] Company payload.output.data is array: ${Array.isArray(outputData)}, length: ${Array.isArray(outputData) ? outputData.length : "N/A"}`);
      const rawCompanyData = outputData?.[0] ?? companyEnrichmentPayload?.data?.[0] ?? companyEnrichmentPayload?.output ?? {};
      console.log(`[preview] Raw company data keys: ${JSON.stringify(Object.keys(rawCompanyData ?? {}))}`);
      // Dump all string/number fields for domain discovery
      const domainHints: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rawCompanyData ?? {})) {
        if (typeof v === "string" || typeof v === "number") domainHints[k] = v;
      }
      console.log(`[preview] Company string fields: ${JSON.stringify(domainHints).slice(0, 3000)}`);
      console.log(`[preview] Final companyDomain: ${finalCompanyDomain ?? "NONE"}, companyName: ${personPreview.companyName ?? "NONE"}`);
    }

    response.json({
      person: personPreview,
      company: companyPreview,
      _enrichment: {
        personPayload: personEnrichment,
        companyPayload: companyEnrichmentPayload,
        linkedinUrl,
        workEmail: resolvedWorkEmail ?? extractedEmail,
        companyDomain: finalCompanyDomain,
      },
    });
  } catch (err) {
    console.error("[preview] Error:", err);
    response.status(500).json({ error: "Failed to preview person" });
  }
});

/* ------------------------------------------------------------------ */
/*  Confirm adding a person + company (saves both)                      */
/* ------------------------------------------------------------------ */

app.post("/persons/confirm", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const { linkedinUrl: rawLinkedinUrl, workEmail: rawWorkEmail, companyDomain, personPayload, companyPayload } = request.body as {
    linkedinUrl?: string;
    workEmail?: string;
    companyDomain?: string;
    personPayload?: any;
    companyPayload?: any;
  };

  console.log(`[confirm-person] linkedinUrl=${rawLinkedinUrl}, workEmail=${rawWorkEmail}, companyDomain=${companyDomain}, hasPersonPayload=${!!personPayload}, hasCompanyPayload=${!!companyPayload}`);

  if (!rawLinkedinUrl && !rawWorkEmail) {
    response.status(400).json({ error: "linkedinUrl or workEmail required" });
    return;
  }

  const memberEmails = await getWorkspaceMemberEmails(userEmail);

  try {
    const personsCollection = await getPersonsCollection();
    const linkedinUrl = rawLinkedinUrl ? normalizeLinkedinUrl(rawLinkedinUrl) : rawWorkEmail ? `email:${rawWorkEmail}` : undefined;

    // Ensure company first
    let companyId: ObjectId | undefined;
    console.log(`[confirm-person] companyDomain=${companyDomain ?? "NONE"}`);
    if (companyDomain) {
      console.log(`[confirm-person] Creating/linking company for domain: ${companyDomain}`);
      const companiesCol = await getCompaniesCollection();
      const existingCompany = await companiesCol.findOne({ domain: companyDomain });
      if (existingCompany) {
        await companiesCol.updateOne({ _id: existingCompany._id }, { $addToSet: { userEmails: userEmail } });
        companyId = existingCompany._id!;
      } else if (companyPayload) {
        const ins = await companiesCol.insertOne({
          userEmails: [userEmail],
          domain: companyDomain,
          createdAt: new Date().toISOString(),
          enrichedAt: new Date().toISOString(),
          enrichmentStatus: "completed",
          enrichmentData: companyPayload,
        });
        companyId = ins.insertedId;
      } else {
        companyId = await ensureCompany(companyDomain, userEmail);
      }
    }

    // Check if person already exists (for this workspace or globally)
    if (linkedinUrl) {
      const existingForWorkspace = await personsCollection.findOne({ linkedinUrl, userEmails: { $in: memberEmails } });
      if (existingForWorkspace) {
        // Already in workspace — update company link if missing
        const setFields: Record<string, unknown> = {};
        if (companyId && !existingForWorkspace.companyId) setFields.companyId = companyId;
        if (companyDomain && !existingForWorkspace.companyDomain) setFields.companyDomain = companyDomain;
        if (Object.keys(setFields).length > 0) {
          await personsCollection.updateOne({ _id: existingForWorkspace._id }, { $set: setFields });
        }
        const updated = await personsCollection.findOne({ _id: existingForWorkspace._id });
        response.status(200).json({ person: updated });
        return;
      }

      const existingGlobal = await personsCollection.findOne({ linkedinUrl });
      if (existingGlobal) {
        // Exists globally — add this user and update company link
        const setFields: Record<string, unknown> = {};
        if (companyId && !existingGlobal.companyId) setFields.companyId = companyId;
        if (companyDomain && !existingGlobal.companyDomain) setFields.companyDomain = companyDomain;
        if (rawWorkEmail && !existingGlobal.workEmail) setFields.workEmail = rawWorkEmail;
        await personsCollection.updateOne(
          { _id: existingGlobal._id },
          { $addToSet: { userEmails: userEmail }, ...(Object.keys(setFields).length > 0 ? { $set: setFields } : {}) },
        );
        const updated = await personsCollection.findOne({ _id: existingGlobal._id });
        response.status(201).json({ person: updated });
        return;
      }
    }

    // Try email search if no work email
    let enrichmentPayload = personPayload;
    if (enrichmentPayload) {
      try {
        const personData = enrichmentPayload?.output?.data?.[0];
        const hasEmail = !!(personData?.work_email ?? personData?.emails?.[0] ?? personData?.personal_email);
        if (!hasEmail && personData?.first_name && personData?.last_name && companyDomain) {
          const foundEmail = await findPersonEmailWithFiber(personData.first_name, personData.last_name, companyDomain);
          if (foundEmail) {
            enrichmentPayload = {
              ...enrichmentPayload,
              output: { ...enrichmentPayload.output, data: [{ ...personData, work_email: foundEmail }] },
            };
          }
        }
      } catch { /* ignore */ }
    }

    const { workEmail: extractedEmail } = extractPersonFields(enrichmentPayload ?? {});
    const finalWorkEmail = rawWorkEmail ?? extractedEmail;

    const createdAt = new Date().toISOString();
    const insertResult = await personsCollection.insertOne({
      userEmails: [userEmail],
      linkedinUrl: linkedinUrl!,
      ...(finalWorkEmail ? { workEmail: finalWorkEmail } : {}),
      ...(companyDomain ? { companyDomain } : {}),
      ...(companyId ? { companyId } : {}),
      createdAt,
      enrichedAt: enrichmentPayload ? createdAt : undefined,
      enrichmentStatus: enrichmentPayload ? "completed" : "pending",
      enrichmentData: enrichmentPayload ?? undefined,
    });

    // Create trigger job if active linkedin_content trigger
    try {
      const triggersCol = await getTriggersCollection();
      const linkedinTrigger = await triggersCol.findOne({ userEmail, triggerType: "linkedin_content", status: "active" });
      if (linkedinTrigger && linkedinUrl && !linkedinUrl.startsWith("email:")) {
        const triggerJobsCol = await getTriggerJobsCollection();
        try {
          await triggerJobsCol.insertOne({
            triggerId: linkedinTrigger._id!,
            userEmail,
            jobType: "LinkedinPost" as const,
            personId: insertResult.insertedId,
            linkedinUrl,
            status: "pending" as const,
            createdAt,
          });
        } catch { /* duplicate — ignore */ }
      }
    } catch { /* ignore */ }

    const savedPerson = await personsCollection.findOne({ _id: insertResult.insertedId });
    response.status(201).json({ person: savedPerson });
  } catch (err) {
    console.error("[confirm-person] Error:", err);
    response.status(500).json({ error: "Failed to add person" });
  }
});

app.post("/persons", async (request, response) => {
  const parsed = createPersonSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Please provide a valid LinkedIn profile URL" });
    return;
  }

  const userEmail = response.locals.userEmail as string;
  const linkedinUrl = normalizeLinkedinUrl(parsed.data.linkedinUrl);
  const reqBuyerProfileId = parsed.data.buyerProfileId ? new ObjectId(parsed.data.buyerProfileId) : undefined;
  const reqCompanyId = parsed.data.companyId ? new ObjectId(parsed.data.companyId) : undefined;
  const personsCollection = await getPersonsCollection();

  const createPersonMemberEmails = await getWorkspaceMemberEmails(userEmail);
  const existingForUser = await personsCollection.findOne({ linkedinUrl, userEmails: { $in: createPersonMemberEmails } });
  if (existingForUser) {
    response.status(409).json({ error: "Person already exists", person: existingForUser });
    return;
  }

  const existingPerson = await personsCollection.findOne({ linkedinUrl });
  if (existingPerson) {
    // Link company if we know the domain but companyId is missing
    let existingCompanyId = reqCompanyId ?? existingPerson.companyId;
    if (!existingCompanyId && existingPerson.companyDomain) {
      existingCompanyId = await ensureCompany(existingPerson.companyDomain, userEmail);
    }
    const setFields: Record<string, unknown> = {};
    if (existingCompanyId && !existingPerson.companyId) setFields.companyId = existingCompanyId;
    if (reqBuyerProfileId && !existingPerson.buyerProfileId) setFields.buyerProfileId = reqBuyerProfileId;
    await personsCollection.updateOne(
      { _id: existingPerson._id },
      { $addToSet: { userEmails: userEmail }, ...(Object.keys(setFields).length > 0 ? { $set: setFields } : {}) },
    );
    // Create trigger job if user has an active linkedin_content trigger
    try {
      const triggersCol = await getTriggersCollection();
      const linkedinTrigger = await triggersCol.findOne({ userEmail, triggerType: "linkedin_content", status: "active" });
      console.log(`[add-person] Existing person path: linkedinTrigger found=${!!linkedinTrigger} for userEmail=${userEmail}`);
      if (linkedinTrigger) {
        const triggerJobsCol = await getTriggerJobsCollection();
        try {
          await triggerJobsCol.insertOne({
            triggerId: linkedinTrigger._id!,
            userEmail,
            jobType: "LinkedinPost" as const,
            personId: existingPerson._id!,
            linkedinUrl,
            status: "pending" as const,
            createdAt: new Date().toISOString(),
          });
          console.log(`[add-person] Created trigger job for existing person ${existingPerson._id} (${linkedinUrl})`);
        } catch (err: any) {
          console.log(`[add-person] Trigger job already exists for existing person ${existingPerson._id}: ${err.message}`);
        }
      }
    } catch (err) {
      console.error(`[add-person] Error creating trigger job for existing person:`, err);
    }
    const updatedPerson = await personsCollection.findOne({ _id: existingPerson._id });
    response.status(201).json({ person: updatedPerson });
    return;
  }

  const createdAt = new Date().toISOString();
  const insertResult = await personsCollection.insertOne({
    userEmails: [userEmail],
    linkedinUrl,
    ...(reqBuyerProfileId ? { buyerProfileId: reqBuyerProfileId } : {}),
    ...(reqCompanyId ? { companyId: reqCompanyId } : {}),
    createdAt,
    enrichmentStatus: "pending",
  });

  const personId = insertResult.insertedId;
  const enrichment = await enrichPersonWithFiber(linkedinUrl);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let enrichmentPayload = enrichment.payload as any;

  if (enrichment.success) {
    try {
      const personData = enrichmentPayload?.output?.data?.[0];

      // If no work email, try people-search by name + domain
      const hasEmail = !!(personData?.work_email ?? personData?.emails?.[0] ?? personData?.personal_email);
      const { companyDomain: domainFromFiber } = extractPersonFields(enrichmentPayload);
      if (!hasEmail && personData?.first_name && personData?.last_name && domainFromFiber) {
        const foundEmail = await findPersonEmailWithFiber(personData.first_name, personData.last_name, domainFromFiber);
        if (foundEmail) {
          enrichmentPayload = {
            ...enrichmentPayload,
            output: { ...enrichmentPayload.output, data: [{ ...personData, work_email: foundEmail }] },
          };
        }
      }
    } catch { /* ignore */ }

    const { workEmail, companyDomain } = extractPersonFields(enrichmentPayload);
    console.log(`[add-person] Extracted fields: workEmail=${workEmail ?? "none"}, companyDomain=${companyDomain ?? "none"}, currentJob keys=${JSON.stringify(Object.keys(enrichmentPayload?.output?.data?.[0]?.current_job ?? {}))}`);
    let companyId: ObjectId | undefined = reqCompanyId;
    if (companyDomain && !companyId) companyId = await ensureCompany(companyDomain, userEmail);
    await personsCollection.updateOne(
      { _id: personId },
      {
        $set: {
          enrichedAt: new Date().toISOString(),
          enrichmentStatus: "completed",
          enrichmentData: enrichmentPayload,
          ...(workEmail ? { workEmail } : {}),
          ...(companyDomain ? { companyDomain } : {}),
          ...(companyId ? { companyId } : {}),
        },
      },
    );
  } else {
    console.log(`[add-person] Enrichment failed: ${enrichment.error ?? "unknown"}`);
    // Even on failure, try to extract company domain from partial payload
    const { companyDomain: failedDomain } = extractPersonFields(enrichmentPayload ?? {});
    let failedCompanyId: ObjectId | undefined = reqCompanyId;
    if (failedDomain && !failedCompanyId) failedCompanyId = await ensureCompany(failedDomain, userEmail);
    await personsCollection.updateOne(
      { _id: personId },
      {
        $set: {
          enrichedAt: new Date().toISOString(),
          enrichmentStatus: "failed",
          enrichmentError: enrichment.error ?? "Fiber enrichment failed",
          enrichmentData: enrichmentPayload,
          ...(failedDomain ? { companyDomain: failedDomain } : {}),
          ...(failedCompanyId ? { companyId: failedCompanyId } : {}),
        },
      },
    );
  }

  // If user has an active linkedin_content trigger, create a trigger job for this person
  try {
    const triggersCol = await getTriggersCollection();
    const linkedinTrigger = await triggersCol.findOne({ userEmail, triggerType: "linkedin_content", status: "active" });
    console.log(`[add-person] New person path: linkedinTrigger found=${!!linkedinTrigger} for userEmail=${userEmail}`);
    if (linkedinTrigger) {
      const triggerJobsCol = await getTriggerJobsCollection();
      try {
        await triggerJobsCol.insertOne({
          triggerId: linkedinTrigger._id!,
          userEmail,
          jobType: "LinkedinPost" as const,
          personId,
          linkedinUrl,
          status: "pending" as const,
          createdAt: new Date().toISOString(),
        });
        console.log(`[add-person] Created linkedin_content trigger job for new person ${personId} (${linkedinUrl})`);
      } catch (err: any) {
        console.log(`[add-person] Trigger job already exists for new person ${personId}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`[add-person] Error creating trigger job for new person:`, err);
  }

  const savedPerson = await personsCollection.findOne({ _id: personId });
  response.status(201).json({ person: savedPerson });
});

// Add a person by work email — looks up their LinkedIn via Fiber, then enriches fully
app.post("/persons/by-email", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const { email, buyerProfileId: rawBuyerProfileId, companyId: rawCompanyId } = request.body as { email?: string; buyerProfileId?: string; companyId?: string };
  const emailReqBuyerProfileId = rawBuyerProfileId ? new ObjectId(rawBuyerProfileId) : undefined;
  const emailReqCompanyId = rawCompanyId ? new ObjectId(rawCompanyId) : undefined;

  if (!email || !email.includes("@")) {
    response.status(400).json({ error: "Please provide a valid email address" });
    return;
  }

  const workEmail = email.trim().toLowerCase();
  const personsCol = await getPersonsCollection();

  const byEmailMemberEmails = await getWorkspaceMemberEmails(userEmail);
  // Check if we already track a person with this email
  const existing = await personsCol.findOne({ workEmail, userEmails: { $in: byEmailMemberEmails } });
  if (existing) {
    response.status(409).json({ error: "Person already exists", person: existing });
    return;
  }

  // Derive company domain from email
  const emailDomain = workEmail.split("@")[1] ?? "";
  const freeDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com"];
  const companyDomainFromEmail = !freeDomains.includes(emailDomain) ? emailDomain : undefined;

  // Use Fiber email-to-person/single to get LinkedIn + full profile
  const fiberResult = await enrichPersonByEmailWithFiber(workEmail);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let enrichmentPayload = fiberResult.payload as any;
  let linkedinUrl: string | undefined;

  if (fiberResult.success && enrichmentPayload) {
    const personData = enrichmentPayload?.output?.data?.[0];
    linkedinUrl =
      personData?.linkedin_url ??
      personData?.linkedinUrl ??
      personData?.linkedin ??
      undefined;
    if (linkedinUrl) linkedinUrl = normalizeLinkedinUrl(linkedinUrl);
  }

  // If Fiber returned a LinkedIn URL, check if that person already exists
  if (linkedinUrl) {
    const existingByLinkedin = await personsCol.findOne({ linkedinUrl, userEmails: { $in: byEmailMemberEmails } });
    if (existingByLinkedin) {
      response.status(409).json({ error: "Person already exists", person: existingByLinkedin });
      return;
    }
    // If person exists under another user, add this user and return
    const existingGlobal = await personsCol.findOne({ linkedinUrl });
    if (existingGlobal) {
      // Ensure company is linked for this user too
      if (existingGlobal.companyDomain) {
        await ensureCompany(existingGlobal.companyDomain, userEmail);
      }
      await personsCol.updateOne(
        { _id: existingGlobal._id },
        { $addToSet: { userEmails: userEmail }, $set: { workEmail } },
      );
      const updated = await personsCol.findOne({ _id: existingGlobal._id });
      response.status(201).json({ person: updated });
      return;
    }
  }

  // If Fiber returned a LinkedIn URL, do a full kitchen-sink enrichment for richer data
  if (linkedinUrl) {
    const kitchenSink = await enrichPersonWithFiber(linkedinUrl);
    if (kitchenSink.success && kitchenSink.payload) {
      enrichmentPayload = kitchenSink.payload;
    }
  }

  const { companyDomain: domainFromFiber } = extractPersonFields(enrichmentPayload);
  const resolvedWorkEmail = workEmail; // we know the email — always use the provided one
  const resolvedDomain = domainFromFiber ?? companyDomainFromEmail;

  // Ensure enrichment payload reflects the known email
  if (enrichmentPayload?.output?.data?.[0] && !enrichmentPayload.output.data[0].work_email) {
    enrichmentPayload = {
      ...enrichmentPayload,
      output: {
        ...enrichmentPayload.output,
        data: [{ ...enrichmentPayload.output.data[0], work_email: resolvedWorkEmail }],
      },
    };
  }

  const createdAt = new Date().toISOString();
  let byEmailCompanyId: ObjectId | undefined = emailReqCompanyId;
  if (resolvedDomain && !byEmailCompanyId) byEmailCompanyId = await ensureCompany(resolvedDomain, userEmail);

  const insertResult = await personsCol.insertOne({
    userEmails: [userEmail],
    linkedinUrl: linkedinUrl ?? `email:${resolvedWorkEmail}`, // stub URL if no LinkedIn found
    workEmail: resolvedWorkEmail,
    ...(resolvedDomain ? { companyDomain: resolvedDomain } : {}),
    ...(byEmailCompanyId ? { companyId: byEmailCompanyId } : {}),
    ...(emailReqBuyerProfileId ? { buyerProfileId: emailReqBuyerProfileId } : {}),
    createdAt,
    enrichedAt: fiberResult.success ? createdAt : undefined,
    enrichmentStatus: fiberResult.success ? "completed" : "failed",
    enrichmentData: enrichmentPayload ?? undefined,
    ...(fiberResult.success ? {} : { enrichmentError: fiberResult.error ?? "Fiber lookup failed" }),
  });

  const savedPerson = await personsCol.findOne({ _id: insertResult.insertedId });
  response.status(201).json({ person: savedPerson });
});

app.delete("/persons/:id", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const personsCollection = await getPersonsCollection();

  let result;
  try {
    result = await personsCollection.updateOne(
      { _id: new ObjectId(request.params.id), userEmails: { $in: memberEmails } },
      { $pull: { userEmails: { $in: memberEmails } } },
    );
  } catch {
    response.status(400).json({ error: "Invalid person ID" });
    return;
  }

  if (result.matchedCount === 0) {
    response.status(404).json({ error: "Person not found" });
    return;
  }

  response.json({ success: true });
});

/* ------------------------------------------------------------------ */
/*  Buyer Profile endpoints                                             */
/* ------------------------------------------------------------------ */

app.get("/buyer-profiles", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const collection = await getBuyerProfilesCollection();
  const profiles = await collection.find({ userEmail: { $in: memberEmails } }).sort({ createdAt: -1 }).toArray();
  response.json({ profiles });
});

app.get("/buyer-profiles/:id", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const collection = await getBuyerProfilesCollection();
  let profile;
  try {
    profile = await collection.findOne({ _id: new ObjectId(request.params.id), userEmail });
  } catch {
    response.status(400).json({ error: "Invalid profile ID" });
    return;
  }
  if (!profile) {
    response.status(404).json({ error: "Buyer profile not found" });
    return;
  }
  response.json({ profile });
});

app.post("/buyer-profiles", async (request, response) => {
  const parsed = createBuyerProfileSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const userEmail = response.locals.userEmail as string;
  const now = new Date().toISOString();
  const collection = await getBuyerProfilesCollection();

  // If this is the first profile, make it default
  const existingCount = await collection.countDocuments({ userEmail });
  const isDefault = existingCount === 0;

  const insertResult = await collection.insertOne({
    userEmail,
    name: parsed.data.name,
    titles: parsed.data.titles,
    isDefault,
    createdAt: now,
    updatedAt: now,
  });

  const profile = await collection.findOne({ _id: insertResult.insertedId });
  response.status(201).json({ profile });
});

app.put("/buyer-profiles/:id", async (request, response) => {
  const parsed = updateBuyerProfileSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const userEmail = response.locals.userEmail as string;
  const collection = await getBuyerProfilesCollection();

  let existingProfile;
  try {
    existingProfile = await collection.findOne({ _id: new ObjectId(request.params.id), userEmail });
  } catch {
    response.status(400).json({ error: "Invalid profile ID" });
    return;
  }
  if (!existingProfile) {
    response.status(404).json({ error: "Buyer profile not found" });
    return;
  }

  const updateFields: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (parsed.data.name !== undefined) updateFields.name = parsed.data.name;
  if (parsed.data.titles !== undefined) updateFields.titles = parsed.data.titles;

  await collection.updateOne(
    { _id: new ObjectId(request.params.id), userEmail },
    { $set: updateFields },
  );

  const updated = await collection.findOne({ _id: new ObjectId(request.params.id) });
  response.json({ profile: updated });
});

app.delete("/buyer-profiles/:id", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const collection = await getBuyerProfilesCollection();

  let result;
  try {
    result = await collection.deleteOne({ _id: new ObjectId(request.params.id), userEmail });
  } catch {
    response.status(400).json({ error: "Invalid profile ID" });
    return;
  }

  if (result.deletedCount === 0) {
    response.status(404).json({ error: "Buyer profile not found" });
    return;
  }

  response.json({ success: true });
});

app.put("/buyer-profiles/:id/set-default", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const collection = await getBuyerProfilesCollection();

  let profile;
  try {
    profile = await collection.findOne({ _id: new ObjectId(request.params.id), userEmail });
  } catch {
    response.status(400).json({ error: "Invalid profile ID" });
    return;
  }
  if (!profile) {
    response.status(404).json({ error: "Buyer profile not found" });
    return;
  }

  // Unset all defaults for this user, then set the selected one
  await collection.updateMany({ userEmail }, { $set: { isDefault: false } });
  await collection.updateOne({ _id: new ObjectId(request.params.id) }, { $set: { isDefault: true } });

  const updated = await collection.findOne({ _id: new ObjectId(request.params.id) });
  response.json({ profile: updated });
});

/* ------------------------------------------------------------------ */
/*  Find Buyers (people search via Fiber)                               */
/* ------------------------------------------------------------------ */

const findBuyersSchema = z.object({
  buyerProfileId: z.string().min(1),
  cursor: z.string().nullable().optional(),
});

// GET cached buyer search results for a company + profile
app.get("/companies/:id/buyers", async (request, response) => {
  const buyerProfileId = request.query.buyerProfileId as string;
  if (!buyerProfileId) {
    response.status(400).json({ error: "Please provide a buyerProfileId query param" });
    return;
  }

  const userEmail = response.locals.userEmail as string;

  let companyObjectId: ObjectId;
  let profileObjectId: ObjectId;
  try {
    companyObjectId = new ObjectId(request.params.id);
    profileObjectId = new ObjectId(buyerProfileId);
  } catch {
    response.status(400).json({ error: "Invalid ID" });
    return;
  }

  const cache = await getBuyerSearchResultsCollection();
  const existing = await cache.findOne({ companyId: companyObjectId, buyerProfileId: profileObjectId, userEmail });

  if (!existing) {
    response.json({ result: null });
    return;
  }

  response.json({
    result: {
      buyers: existing.buyers,
      fetchedAt: existing.fetchedAt,
      nextCursor: existing.nextCursor,
    },
  });
});

// POST to search Fiber and persist results
app.post("/companies/:id/find-buyers", async (request, response) => {
  const parsed = findBuyersSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Please provide a buyer profile ID" });
    return;
  }

  const userEmail = response.locals.userEmail as string;

  // Get the company
  const companiesCollection = await getCompaniesCollection();
  let company;
  try {
    const findBuyersMemberEmails = await getWorkspaceMemberEmails(userEmail);
    company = await companiesCollection.findOne({ _id: new ObjectId(request.params.id), userEmails: { $in: findBuyersMemberEmails } });
  } catch {
    response.status(400).json({ error: "Invalid company ID" });
    return;
  }
  if (!company) {
    response.status(404).json({ error: "Company not found" });
    return;
  }

  // Get the buyer profile
  const profilesCollection = await getBuyerProfilesCollection();
  let buyerProfile;
  try {
    buyerProfile = await profilesCollection.findOne({ _id: new ObjectId(parsed.data.buyerProfileId), userEmail });
  } catch {
    response.status(400).json({ error: "Invalid buyer profile ID" });
    return;
  }
  if (!buyerProfile) {
    response.status(404).json({ error: "Buyer profile not found" });
    return;
  }

  const cursor = parsed.data.cursor ?? null;

  // Search Fiber
  const result = await searchBuyersWithFiber(company.domain, buyerProfile.titles, cursor);

  if (!result.success) {
    response.status(502).json({ error: result.error ?? "Fiber search failed" });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload = result.payload as any;
  const newBuyers = (payload?.output?.data ?? []) as Record<string, unknown>[];
  const nextCursor = (payload?.output?.nextCursor as string | null) ?? null;

  const companyObjectId = company._id!;
  const buyerProfileObjectId = buyerProfile._id!;
  const cache = await getBuyerSearchResultsCollection();

  if (cursor) {
    await cache.updateOne(
      { companyId: companyObjectId, buyerProfileId: buyerProfileObjectId, userEmail },
      { $push: { buyers: { $each: newBuyers } }, $set: { nextCursor } },
    );
  } else {
    await cache.updateOne(
      { companyId: companyObjectId, buyerProfileId: buyerProfileObjectId, userEmail },
      {
        $set: {
          companyId: companyObjectId,
          buyerProfileId: buyerProfileObjectId,
          userEmail,
          buyers: newBuyers,
          fetchedAt: new Date().toISOString(),
          nextCursor,
        },
      },
      { upsert: true },
    );
  }

  // Upsert each buyer as a person record linked to this company
  if (newBuyers.length > 0) {
    const personsCol = await getPersonsCollection();
    const now = new Date().toISOString();
    await Promise.all(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newBuyers.map(async (buyer: any) => {
        const rawLinkedin: string | undefined =
          buyer.linkedin_url ?? buyer.linkedinUrl ?? buyer.linkedin ?? undefined;
        if (!rawLinkedin) return;
        let linkedinUrl: string;
        try { linkedinUrl = normalizeLinkedinUrl(rawLinkedin); } catch { return; }
        await personsCol.updateOne(
          { linkedinUrl },
          {
            $setOnInsert: { linkedinUrl, createdAt: now, enrichmentStatus: "pending" },
            $addToSet: { userEmails: userEmail },
            $set: {
              companyId: companyObjectId,
              companyDomain: company.domain,
              buyerProfileId: buyerProfileObjectId,
              ...(buyer.work_email ? { workEmail: buyer.work_email } : {}),
            },
          },
          { upsert: true },
        );
      })
    );
  }

  response.json({ result: result.payload });
});

/* ------------------------------------------------------------------ */
/*  Company ATS Detection endpoints                                    */
/* ------------------------------------------------------------------ */

// GET ATS information for a company
app.get("/companies/:id/ats", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const companiesCollection = await getCompaniesCollection();

  let company;
  try {
    company = await companiesCollection.findOne({ _id: new ObjectId(request.params.id), userEmails: { $in: memberEmails } });
  } catch {
    response.status(400).json({ error: "Invalid company ID" });
    return;
  }

  if (!company) {
    response.status(404).json({ error: "Company not found" });
    return;
  }

  const atsCollection = await getCompanyATSCollection();
  const atsRecord = await atsCollection.findOne({ companyId: company._id! });

  response.json({ ats: atsRecord ?? null });
});

// POST to detect ATS for a company
app.post("/companies/:id/detect-ats", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const companiesCollection = await getCompaniesCollection();

  console.log(`[detect-ats] Request from ${userEmail} for company ${request.params.id}`);

  let company;
  try {
    company = await companiesCollection.findOne({ _id: new ObjectId(request.params.id), userEmails: { $in: memberEmails } });
  } catch {
    console.log(`[detect-ats] Invalid company ID: ${request.params.id}`);
    response.status(400).json({ error: "Invalid company ID" });
    return;
  }

  if (!company) {
    console.log(`[detect-ats] Company not found: ${request.params.id}`);
    response.status(404).json({ error: "Company not found" });
    return;
  }

  console.log(`[detect-ats] Found company: domain=${company.domain} id=${company._id}`);

  const atsCollection = await getCompanyATSCollection();
  const companyId = company._id!;

  // Check if detection already exists and completed successfully
  const existing = await atsCollection.findOne({ companyId });
  if (existing && existing.detectionStatus === "completed") {
    console.log(`[detect-ats] ATS already detected for ${company.domain}: atsName=${existing.atsName} status=${existing.detectionStatus}`);
    response.json({ ats: existing, message: "ATS already detected" });
    return;
  }

  // If a previous attempt failed or is pending, delete it so we can retry
  if (existing) {
    console.log(`[detect-ats] Removing previous ${existing.detectionStatus} ATS record for ${company.domain} to retry`);
    await atsCollection.deleteOne({ companyId });
  }

  // Create pending record
  const createdAt = new Date().toISOString();
  await atsCollection.insertOne({
    companyId,
    domain: company.domain,
    detectedAt: createdAt,
    detectionStatus: "pending",
  });
  console.log(`[detect-ats] Created pending ATS record for ${company.domain}`);

  // Detect ATS
  console.log(`[detect-ats] Calling detectCompanyATS for ${company.domain}...`);
  const detection = await detectCompanyATS(company.domain);
  console.log(`[detect-ats] Detection result for ${company.domain}: success=${detection.success} atsName=${detection.data?.atsName ?? "N/A"} careerPageURL=${detection.data?.careerPageURL ?? "N/A"} error=${detection.error ?? "none"}`);

  if (detection.success && detection.data) {
    await atsCollection.updateOne(
      { companyId },
      {
        $set: {
          atsName: detection.data.atsName ?? null,
          atsUrlSlug: detection.data.atsSlug ?? null,
          careerPageUrl: detection.data.careerPageURL ?? null,
          detectionStatus: "completed",
          rawData: detection.rawData,
        },
      },
    );
    console.log(`[detect-ats] Updated ATS record to completed for ${company.domain}`);
  } else {
    await atsCollection.updateOne(
      { companyId },
      {
        $set: {
          detectionStatus: "failed",
          detectionError: detection.error ?? "ATS detection failed",
          rawData: detection.rawData,
        },
      },
    );
    console.log(`[detect-ats] Updated ATS record to failed for ${company.domain}: ${detection.error}`);
  }

  const updated = await atsCollection.findOne({ companyId });

  // If ATS was successfully detected with a careerPageUrl, create an ATSJobs trigger job
  // for any active ats_jobs trigger this user has
  if (detection.success && detection.data?.careerPageURL) {
    console.log(`[detect-ats] Checking for active ats_jobs trigger for user ${userEmail}...`);
    try {
      const triggersCol = await getTriggersCollection();
      const atsJobsTrigger = await triggersCol.findOne({ userEmail, triggerType: "ats_jobs", status: "active" });

      if (atsJobsTrigger) {
        console.log(`[detect-ats] Found active ats_jobs trigger ${atsJobsTrigger._id}, creating trigger job for ${company.domain}`);
        const triggerJobsCol = await getTriggerJobsCollection();
        const now2 = new Date().toISOString();
        try {
          await triggerJobsCol.insertOne({
            triggerId: atsJobsTrigger._id!,
            userEmail,
            jobType: "ATSJobs",
            companyId,
            atsUrl: detection.data.careerPageURL,
            domain: company.domain,
            status: "pending",
            createdAt: now2,
          });
          console.log(`[detect-ats] Created ATSJobs trigger job for ${company.domain}`);
        } catch {
          console.log(`[detect-ats] ATSJobs trigger job already exists for ${company.domain}`);
        }
      } else {
        console.log(`[detect-ats] No active ats_jobs trigger found for user ${userEmail}`);
      }
    } catch (err) {
      console.error(`[detect-ats] Error creating trigger job:`, err);
    }
  }

  console.log(`[detect-ats] Returning ATS result for ${company.domain}: status=${updated?.detectionStatus}`);
  response.json({ ats: updated });
});

/* ------------------------------------------------------------------ */
/*  Jobs endpoints                                                       */
/* ------------------------------------------------------------------ */

// GET all jobs for a company
app.get("/companies/:id/jobs", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const companiesCollection = await getCompaniesCollection();

  let company;
  try {
    company = await companiesCollection.findOne({ _id: new ObjectId(request.params.id), userEmails: { $in: memberEmails } });
  } catch {
    response.status(400).json({ error: "Invalid company ID" });
    return;
  }

  if (!company) {
    response.status(404).json({ error: "Company not found" });
    return;
  }

  const jobsCol = await getJobsCollection();
  const jobs = await jobsCol
    .find({ companyId: company._id! })
    .sort({ fetchedAt: -1 })
    .limit(200)
    .toArray();

  response.json({ jobs });
});

/* ------------------------------------------------------------------ */
/*  Triggers endpoints                                                   */
/* ------------------------------------------------------------------ */

const createTriggerSchema = z.object({
  triggerType: z.enum(["linkedin_content", "ats_jobs"]),
  keyword: z.string().nullable().optional(),
  jobTitles: z.array(z.string()).nullable().optional(),
});

const updateTriggerSchema = z.object({
  keyword: z.string().nullable().optional(),
  jobTitles: z.array(z.string()).nullable().optional(),
  status: z.enum(["active", "paused"]).optional(),
});

app.get("/triggers", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const collection = await getTriggersCollection();
  const triggers = await collection.find({ userEmail: { $in: memberEmails } }).sort({ createdAt: -1 }).toArray();
  response.json({ triggers });
});

app.post("/triggers", async (request, response) => {
  const parsed = createTriggerSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid trigger configuration" });
    return;
  }

  const userEmail = response.locals.userEmail as string;
  const triggersCol = await getTriggersCollection();

  // Check if trigger already exists for this user
  const existing = await triggersCol.findOne({ userEmail, triggerType: parsed.data.triggerType });
  if (existing) {
    response.status(409).json({ error: "Trigger already enabled", trigger: existing });
    return;
  }

  const now = new Date().toISOString();
  const insertResult = await triggersCol.insertOne({
    userEmail,
    triggerType: parsed.data.triggerType,
    config: { keyword: parsed.data.keyword ?? null, jobTitles: parsed.data.jobTitles ?? null },
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  const triggerId = insertResult.insertedId;
  const triggerJobsCol = await getTriggerJobsCollection();
  let jobsCreated = 0;

  if (parsed.data.triggerType === "linkedin_content") {
    // Create TriggerJob entries for all persons this user tracks
    const personsCol = await getPersonsCollection();
    const persons = await personsCol.find({ userEmails: userEmail }).toArray();
    console.log(`[create-trigger] Found ${persons.length} persons for userEmail=${userEmail}`);
    for (const p of persons) {
      console.log(`[create-trigger]   person _id=${p._id} linkedinUrl=${p.linkedinUrl} userEmails=${JSON.stringify(p.userEmails)}`);
    }

    if (persons.length > 0) {
      const jobDocs = persons.map((person) => ({
        triggerId,
        userEmail,
        jobType: "LinkedinPost" as const,
        personId: person._id!,
        linkedinUrl: person.linkedinUrl,
        status: "pending" as const,
        createdAt: now,
      }));
      console.log(`[create-trigger] Attempting to insert ${jobDocs.length} trigger jobs for triggerId=${triggerId}`);
      try {
        const bulkResult = await triggerJobsCol.insertMany(jobDocs, { ordered: false });
        jobsCreated = bulkResult.insertedCount;
        console.log(`[create-trigger] insertMany succeeded: insertedCount=${bulkResult.insertedCount}`);
      } catch (err: any) {
        // With ordered:false, BulkWriteError is thrown but successful inserts still go through
        jobsCreated = err?.result?.insertedCount ?? err?.insertedCount ?? 0;
        console.error(`[create-trigger] insertMany error: ${err.message}, insertedCount=${jobsCreated}`);
      }
    } else {
      console.log(`[create-trigger] No persons found for ${userEmail} — skipping trigger job creation`);
    }
  } else if (parsed.data.triggerType === "ats_jobs") {
    // Create TriggerJob entries for all companies — auto-detect ATS for those missing it
    const companiesCol = await getCompaniesCollection();
    const atsCol = await getCompanyATSCollection();

    const triggerMemberEmails = await getWorkspaceMemberEmails(userEmail);
    const userCompanies = await companiesCol.find({ userEmails: { $in: triggerMemberEmails } }).toArray();
    const companyIds = userCompanies.map((c) => c._id!);

    if (companyIds.length > 0) {
      // Find companies that already have ATS detected
      const existingAtsRecords = await atsCol
        .find({ companyId: { $in: companyIds } })
        .toArray();
      const atsCompanyIdSet = new Set(existingAtsRecords.map((a) => a.companyId.toHexString()));

      // Auto-detect ATS for companies that don't have it yet
      const companiesWithoutAts = userCompanies.filter((c) => !atsCompanyIdSet.has(c._id!.toHexString()));
      for (const comp of companiesWithoutAts) {
        console.log(`[create-trigger] Auto-detecting ATS for ${comp.domain}...`);
        const atsNow = new Date().toISOString();
        await atsCol.insertOne({
          companyId: comp._id!,
          domain: comp.domain,
          detectedAt: atsNow,
          detectionStatus: "pending",
        });
        const detection = await detectCompanyATS(comp.domain);
        if (detection.success && detection.data) {
          await atsCol.updateOne(
            { companyId: comp._id! },
            {
              $set: {
                atsName: detection.data.atsName ?? null,
                atsUrlSlug: detection.data.atsSlug ?? null,
                careerPageUrl: detection.data.careerPageURL ?? null,
                detectionStatus: "completed",
                rawData: detection.rawData,
              },
            },
          );
          console.log(`[create-trigger] ATS detected for ${comp.domain}: ${detection.data.atsName}`);
        } else {
          await atsCol.updateOne(
            { companyId: comp._id! },
            {
              $set: {
                detectionStatus: "failed",
                detectionError: detection.error ?? "ATS detection failed",
                rawData: detection.rawData,
              },
            },
          );
          console.log(`[create-trigger] ATS detection failed for ${comp.domain}: ${detection.error}`);
        }
      }

      // Now fetch all completed ATS records with careerPageUrl
      const atsRecords = await atsCol
        .find({ companyId: { $in: companyIds }, detectionStatus: "completed", careerPageUrl: { $nin: [null, ""] } })
        .toArray();
      console.log(`[trigger-save] Found ${atsRecords.length} ATS records with careerPageUrl out of ${companyIds.length} companies`);
      for (const ats of atsRecords) {
        console.log(`[trigger-save] ATS queued: domain=${ats.domain} careerPageUrl=${ats.careerPageUrl} atsName=${ats.atsName}`);
      }

      if (atsRecords.length > 0) {
        const jobDocs = atsRecords.map((ats) => ({
          triggerId,
          userEmail,
          jobType: "ATSJobs" as const,
          companyId: ats.companyId,
          atsUrl: ats.careerPageUrl!,
          domain: ats.domain,
          status: "pending" as const,
          createdAt: now,
        }));
        await triggerJobsCol.insertMany(jobDocs, { ordered: false });
        jobsCreated = atsRecords.length;
      }
    }
  }

  const trigger = await triggersCol.findOne({ _id: triggerId });
  response.status(201).json({ trigger, jobsCreated });
});

app.put("/triggers/:id", async (request, response) => {
  const parsed = updateTriggerSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid input" });
    return;
  }

  const userEmail = response.locals.userEmail as string;
  const triggersCol = await getTriggersCollection();

  let trigger;
  try {
    trigger = await triggersCol.findOne({ _id: new ObjectId(request.params.id), userEmail });
  } catch {
    response.status(400).json({ error: "Invalid trigger ID" });
    return;
  }
  if (!trigger) {
    response.status(404).json({ error: "Trigger not found" });
    return;
  }

  const updateFields: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (parsed.data.keyword !== undefined) updateFields["config.keyword"] = parsed.data.keyword;
  if (parsed.data.jobTitles !== undefined) updateFields["config.jobTitles"] = parsed.data.jobTitles;
  if (parsed.data.status !== undefined) updateFields.status = parsed.data.status;

  await triggersCol.updateOne({ _id: trigger._id }, { $set: updateFields });

  const updated = await triggersCol.findOne({ _id: trigger._id });
  response.json({ trigger: updated });
});

app.delete("/triggers/:id", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const triggersCol = await getTriggersCollection();

  let trigger;
  try {
    trigger = await triggersCol.findOne({ _id: new ObjectId(request.params.id), userEmail });
  } catch {
    response.status(400).json({ error: "Invalid trigger ID" });
    return;
  }
  if (!trigger) {
    response.status(404).json({ error: "Trigger not found" });
    return;
  }

  // Delete the trigger and all associated jobs
  const triggerJobsCol = await getTriggerJobsCollection();
  await triggerJobsCol.deleteMany({ triggerId: trigger._id });
  await triggersCol.deleteOne({ _id: trigger._id });

  response.json({ success: true });
});

// Manually trigger processing (for testing)
app.post("/triggers/trigger-processing", async (_request, response) => {
  const count = await triggerTriggersProcessing();
  response.json({ success: true, jobsEnqueued: count });
});

/* ------------------------------------------------------------------ */
/*  Trigger Jobs endpoints                                               */
/* ------------------------------------------------------------------ */

// List all trigger jobs for the current user
app.get("/trigger-jobs", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const triggerJobsCol = await getTriggerJobsCollection();
  const jobs = await triggerJobsCol.find({ userEmail }).sort({ createdAt: -1 }).limit(500).toArray();
  console.log(`[get-trigger-jobs] Returning ${jobs.length} trigger jobs for userEmail=${userEmail}`);
  const linkedinJobs = jobs.filter(j => j.jobType === "LinkedinPost");
  const atsJobs = jobs.filter(j => j.jobType === "ATSJobs");
  console.log(`[get-trigger-jobs] Breakdown: ${linkedinJobs.length} LinkedinPost, ${atsJobs.length} ATSJobs`);
  for (const j of linkedinJobs) {
    console.log(`[get-trigger-jobs]   LinkedinPost: _id=${j._id} personId=${j.personId} linkedinUrl=${j.linkedinUrl} status=${j.status}`);
  }
  response.json({ jobs });
});

// Create / reset pending jobs (without running)
app.post("/trigger-jobs/create", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const count = await createPendingJobs(userEmail);
  response.json({ success: true, jobsCreated: count });
});

// Run all pending jobs for the current user
app.post("/trigger-jobs/run", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const count = await enqueuePendingJobsForUser(userEmail);
  response.json({ success: true, jobsEnqueued: count });
});

// Run a specific job by ID
app.post("/trigger-jobs/:id/run", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const success = await enqueueSpecificJob(request.params.id, userEmail);
  if (!success) {
    response.status(404).json({ error: "Job not found" });
    return;
  }
  response.json({ success: true });
});

/* ------------------------------------------------------------------ */
/*  Signals endpoints                                                    */
/* ------------------------------------------------------------------ */

app.get("/signals", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const signalsCol = await getSignalsCollection();
  const postsCol = await getLinkedinPostsForUserCollection();

  const limit = Math.min(parseInt(request.query.limit as string) || 50, 200);
  const offset = parseInt(request.query.offset as string) || 0;

  const since = request.query.since ? new Date(request.query.since as string).toISOString() : null;
  const before = request.query.before ? new Date(request.query.before as string).toISOString() : null;

  // Build date filter for each collection (LinkedIn uses postedAt, ATS uses createdAt)
  const postDateFilter: Record<string, string> = {};
  const atsDateFilter: Record<string, string> = {};
  if (since) { postDateFilter.$gte = since; atsDateFilter.$gte = since; }
  if (before) { postDateFilter.$lt = before; atsDateFilter.$lt = before; }

  const linkedinFilter: Record<string, unknown> = { userEmail: { $in: memberEmails } };
  if (since || before) linkedinFilter.postedAt = postDateFilter;

  const atsFilter: Record<string, unknown> = { userEmail: { $in: memberEmails }, signalType: "ats_new_job" };
  if (since || before) atsFilter.createdAt = atsDateFilter;

  // Include dismissed signals (frontend splits active vs dismissed)

  // Fetch from both sources in parallel
  const [rawPosts, atsSignals] = await Promise.all([
    postsCol.find(linkedinFilter).sort({ postedAt: -1 }).toArray(),
    signalsCol.find(atsFilter).sort({ createdAt: -1 }).toArray(),
  ]);

  // Shape LinkedIn posts into signal-like objects
  const linkedinSignals = rawPosts.map((post) => ({
    _id: post._id,
    signalType: "linkedin_post" as const,
    personName: post.authorName,
    personLinkedinUrl: post.linkedinUrl,
    matchedKeyword: null,
    createdAt: post.postedAt,
    dismissed: post.dismissed ?? false,
    dismissedAt: post.dismissedAt,
    data: {
      postId: post.postId,
      postUrl: post.postUrl,
      caption: post.caption,
      postedAt: post.postedAt,
      authorName: post.authorName,
      authorLinkedinUrl: post.authorLinkedinUrl,
      authorProfilePicture: post.authorProfilePicture,
      engagement: post.engagement,
      imageUrls: post.imageUrls,
      hasVideo: post.hasVideo,
      isReshare: post.isReshare,
    },
  }));

  // Merge and sort by date descending
  const all = [...linkedinSignals, ...atsSignals].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const total = all.length;
  const signals = all.slice(offset, offset + limit);

  response.json({ signals, total, limit, offset });
});

app.delete("/signals/:id", async (request, response) => {
  const userEmail = response.locals.userEmail as string;

  let id: ObjectId;
  try {
    id = new ObjectId(request.params.id);
  } catch {
    response.status(400).json({ error: "Invalid signal ID" });
    return;
  }

  const now = new Date().toISOString();

  // Soft-delete: mark as dismissed rather than removing the record
  const signalsCol = await getSignalsCollection();
  const atsResult = await signalsCol.updateOne(
    { _id: id, userEmail },
    { $set: { dismissed: true, dismissedAt: now } },
  );
  if (atsResult.matchedCount > 0) {
    response.json({ success: true });
    return;
  }

  const postsCol = await getLinkedinPostsForUserCollection();
  const postResult = await postsCol.updateOne(
    { _id: id, userEmail },
    { $set: { dismissed: true, dismissedAt: now } },
  );
  if (postResult.matchedCount > 0) {
    response.json({ success: true });
    return;
  }

  response.status(404).json({ error: "Signal not found" });
});

app.post("/signals/:id/restore", async (request, response) => {
  const userEmail = response.locals.userEmail as string;

  let id: ObjectId;
  try {
    id = new ObjectId(request.params.id);
  } catch {
    response.status(400).json({ error: "Invalid signal ID" });
    return;
  }

  const signalsCol = await getSignalsCollection();
  const atsResult = await signalsCol.updateOne(
    { _id: id, userEmail },
    { $set: { dismissed: false }, $unset: { dismissedAt: "" } },
  );
  if (atsResult.matchedCount > 0) {
    response.json({ success: true });
    return;
  }

  const postsCol = await getLinkedinPostsForUserCollection();
  const postResult = await postsCol.updateOne(
    { _id: id, userEmail },
    { $set: { dismissed: false }, $unset: { dismissedAt: "" } },
  );
  if (postResult.matchedCount > 0) {
    response.json({ success: true });
    return;
  }

  response.status(404).json({ error: "Signal not found" });
});

app.post("/signals/backfill-linkedin", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const postsCol = await getLinkedinPostsForUserCollection();
  const legacyCol = await getLegacyLinkedinContentForPersonCollection();
  const signalsCol = await getSignalsCollection();
  const triggersCol = await getTriggersCollection();
  const personsCol = await getPersonsCollection();

  const trigger = await triggersCol.findOne({ userEmail, triggerType: "linkedin_content" });

  // Collect posts from new per-user collection
  const newPosts = await postsCol.find({ userEmail }).toArray();

  // Also collect posts from legacy collection (filtered by persons the user tracks)
  const userPersons = await personsCol.find({ userEmails: userEmail }).toArray();
  const legacyPosts = await legacyCol.find({ personId: { $in: userPersons.map((p) => p._id!) } }).toArray();

  // Merge, deduplicating by postId (prefer new collection records)
  const seen = new Set<string>();
  const allPosts: Array<{
    personId: ObjectId;
    linkedinUrl: string;
    postId: string;
    postUrl: string;
    caption: string | null;
    postedAt: string;
    authorName: string;
    authorLinkedinUrl: string;
    authorProfilePicture: string | null;
    engagement: { numComments: number; numShares: number; numReactions: number };
    imageUrls: string[] | null;
    hasVideo: boolean;
    isReshare: boolean;
  }> = [];

  for (const p of [...newPosts, ...legacyPosts]) {
    const pid = p.postId as string;
    if (seen.has(pid)) continue;
    seen.add(pid);
    allPosts.push(p as typeof allPosts[number]);
  }

  let created = 0;
  let skipped = 0;

  for (const post of allPosts) {
    try {
      await signalsCol.insertOne({
        userEmail,
        triggerId: trigger?._id ?? new ObjectId(),
        signalType: "linkedin_post",
        personId: post.personId,
        personName: post.authorName,
        personLinkedinUrl: post.linkedinUrl,
        data: {
          postId: post.postId,
          postUrl: post.postUrl,
          caption: post.caption,
          postedAt: post.postedAt,
          authorName: post.authorName,
          authorLinkedinUrl: post.authorLinkedinUrl,
          authorProfilePicture: post.authorProfilePicture,
          engagement: post.engagement,
          imageUrls: post.imageUrls,
          hasVideo: post.hasVideo,
          isReshare: post.isReshare,
        },
        matchedKeyword: trigger?.config?.keyword ?? null,
        createdAt: post.postedAt,
      });
      created++;
    } catch (err: unknown) {
      if (err instanceof Error && "code" in err && (err as any).code === 11000) {
        skipped++;
        continue;
      }
      throw err;
    }
  }

  response.json({ created, skipped, total: allPosts.length });
});

/* ------------------------------------------------------------------ */
/*  Skills endpoints                                                      */
/* ------------------------------------------------------------------ */

const skillTypeSchema = z.object({
  skillType: z.enum(["detect_ats"]),
});

// GET all skills for the workspace
app.get("/skills", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const skillsCol = await getSkillsCollection();
  const skills = await skillsCol.find({ userEmail: { $in: memberEmails } }).toArray();
  response.json({ skills });
});

// POST enable a skill
app.post("/skills", async (request, response) => {
  const parsed = skillTypeSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid skill type" });
    return;
  }

  const userEmail = response.locals.userEmail as string;
  const skillsCol = await getSkillsCollection();

  const existing = await skillsCol.findOne({ userEmail, skillType: parsed.data.skillType });
  if (existing) {
    // Re-enable if disabled
    if (!existing.enabled) {
      await skillsCol.updateOne(
        { _id: existing._id },
        { $set: { enabled: true, updatedAt: new Date().toISOString() } },
      );
      const updated = await skillsCol.findOne({ _id: existing._id });
      response.json({ skill: updated });
      return;
    }
    response.json({ skill: existing, message: "Skill already enabled" });
    return;
  }

  const now = new Date().toISOString();
  const result = await skillsCol.insertOne({
    userEmail,
    skillType: parsed.data.skillType,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });

  const skill = await skillsCol.findOne({ _id: result.insertedId });
  response.status(201).json({ skill });
});

// PUT toggle a skill
app.put("/skills/:id", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const skillsCol = await getSkillsCollection();

  let skill;
  try {
    skill = await skillsCol.findOne({ _id: new ObjectId(request.params.id), userEmail });
  } catch {
    response.status(400).json({ error: "Invalid skill ID" });
    return;
  }
  if (!skill) {
    response.status(404).json({ error: "Skill not found" });
    return;
  }

  const enabled = typeof request.body.enabled === "boolean" ? request.body.enabled : !skill.enabled;
  await skillsCol.updateOne(
    { _id: skill._id },
    { $set: { enabled, updatedAt: new Date().toISOString() } },
  );

  const updated = await skillsCol.findOne({ _id: skill._id });
  response.json({ skill: updated });
});

// DELETE disable a skill
app.delete("/skills/:id", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const skillsCol = await getSkillsCollection();

  let skill;
  try {
    skill = await skillsCol.findOne({ _id: new ObjectId(request.params.id), userEmail });
  } catch {
    response.status(400).json({ error: "Invalid skill ID" });
    return;
  }
  if (!skill) {
    response.status(404).json({ error: "Skill not found" });
    return;
  }

  await skillsCol.updateOne(
    { _id: skill._id },
    { $set: { enabled: false, updatedAt: new Date().toISOString() } },
  );

  response.json({ success: true });
});

/* ------------------------------------------------------------------ */
/*  Global error handler — always return JSON, never HTML                 */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : "Internal server error";
  const stack = err instanceof Error ? err.stack : undefined;
  console.error("[global-error]", message, stack);
  if (!res.headersSent) {
    res.status(500).json({ error: message });
  }
});

/* ------------------------------------------------------------------ */
/*  Google OAuth + Gmail                                                 */
/* ------------------------------------------------------------------ */

// Connect an additional Google account to the workspace (must be signed in)
app.get("/auth/google/url", (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const returnPath = (request.query.returnPath as string) || "/dashboard/settings/workspace";
  const state = Buffer.from(JSON.stringify({ mode: "connect", userEmail, returnPath })).toString("base64");
  const url = getGoogleAuthUrl(state);
  response.json({ url });
});

// Workspace-level Gmail/Calendar connection status
app.get("/gmail/status", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const googleTokensCol = await getGoogleTokensCollection();
  const usersCol = await getUsersCollection();
  const connectedTokens = await googleTokensCol.find({ userEmail: { $in: memberEmails } }).toArray();
  const connected = connectedTokens.length > 0;
  const connectedUsers = connectedTokens.map((t) => ({ email: t.userEmail }));
  const selfConnected = connectedTokens.some((t) => t.userEmail === userEmail);

  // Per-service connection flags for the requesting user
  const selfUser = await usersCol.findOne({ email: userEmail });
  const selfToken = connectedTokens.find((t) => t.userEmail === userEmail);
  const hasGmailScope = selfToken?.scope?.includes("gmail") ?? false;
  const hasCalendarScope = selfToken?.scope?.includes("calendar") ?? false;

  // gmailConnected/calendarConnected: explicit flag if set, otherwise infer from token scopes
  const gmailConnected = selfUser?.gmailConnected ?? hasGmailScope;
  const calendarConnected = selfUser?.calendarConnected ?? hasCalendarScope;

  response.json({ connected, selfConnected, connectedUsers, gmailConnected, calendarConnected });
});

// Disconnect Gmail
app.post("/gmail/disconnect", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const usersCol = await getUsersCollection();
  await usersCol.updateOne(
    { email: userEmail },
    { $set: { gmailConnected: false, updatedAt: new Date().toISOString() } },
  );
  response.json({ ok: true });
});

// Disconnect Calendar
app.post("/calendar/disconnect", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const usersCol = await getUsersCollection();
  await usersCol.updateOne(
    { email: userEmail },
    { $set: { calendarConnected: false, updatedAt: new Date().toISOString() } },
  );
  response.json({ ok: true });
});

// Reconnect Gmail (re-enable without new OAuth if token already has scopes)
app.post("/gmail/connect", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const googleTokensCol = await getGoogleTokensCollection();
  const token = await googleTokensCol.findOne({ userEmail });
  if (!token?.scope?.includes("gmail")) {
    response.json({ ok: false, needsOAuth: true });
    return;
  }
  const usersCol = await getUsersCollection();
  await usersCol.updateOne(
    { email: userEmail },
    { $set: { gmailConnected: true, updatedAt: new Date().toISOString() } },
  );
  response.json({ ok: true });
});

// Reconnect Calendar (re-enable without new OAuth if token already has scopes)
app.post("/calendar/connect", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const googleTokensCol = await getGoogleTokensCollection();
  const token = await googleTokensCol.findOne({ userEmail });
  if (!token?.scope?.includes("calendar")) {
    response.json({ ok: false, needsOAuth: true });
    return;
  }
  const usersCol = await getUsersCollection();
  await usersCol.updateOne(
    { email: userEmail },
    { $set: { calendarConnected: true, updatedAt: new Date().toISOString() } },
  );
  response.json({ ok: true });
});

// Unified inbox — threads from all workspace members' Gmail connections
app.get("/inbox/emails", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const googleTokensCol = await getGoogleTokensCollection();
  const personsCol = await getPersonsCollection();
  const usersCol = await getUsersCollection();

  // Build member name map + sharing eligibility
  const memberUserRecords = await usersCol.find({ email: { $in: memberEmails } }).toArray();
  const memberNameMap = new Map(memberUserRecords.map((u) => [u.email, u.fullName ?? u.email]));

  // Only use tokens from members who have sharing enabled (or are the requester themselves)
  // Also respect the gmailConnected flag — if explicitly false, exclude that member's token
  const selfUser = memberUserRecords.find((m) => m.email === userEmail);
  const sharingEnabledEmails = new Set<string>();
  if (selfUser?.gmailConnected !== false) sharingEnabledEmails.add(userEmail);
  for (const m of memberUserRecords) {
    if (m.email !== userEmail && m.shareWithWorkspace !== false && m.gmailConnected !== false) sharingEnabledEmails.add(m.email);
  }

  // Collect workspace members with Gmail connected and sharing enabled
  const allTokens = await googleTokensCol.find({ userEmail: { $in: [...sharingEnabledEmails] } }).toArray();
  if (allTokens.length === 0) {
    response.status(403).json({ error: "Gmail not connected" });
    return;
  }

  // Collect all tracked persons with enriched emails (workspace-wide)
  const persons = await personsCol.find({ userEmails: { $in: memberEmails }, enrichmentStatus: "completed" }).toArray();
  const personEmailMeta: { email: string; name: string; personId: string; companyDomain?: string; companyName?: string; profilePic?: string }[] = [];
  const seen = new Set<string>();

  for (const person of persons) {
    const email: string | undefined =
      person.workEmail ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((person.enrichmentData as any)?.output?.data?.[0]?.work_email) ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((person.enrichmentData as any)?.output?.data?.[0]?.emails?.[0]);
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (person.enrichmentData as any)?.output?.data?.[0];
    const nameParts = [data?.first_name, data?.last_name].filter(Boolean);
    const name: string = data?.name ?? (nameParts.length > 0 ? nameParts.join(" ") : email);
    const companyDomain: string | undefined = person.companyDomain ?? data?.company_domain ?? undefined;
    const companyName: string | undefined = data?.company ?? undefined;
    const profilePic: string | undefined = data?.profile_pic ?? undefined;
    personEmailMeta.push({ email, name, personId: person._id!.toHexString(), companyDomain, companyName, profilePic });
  }

  if (personEmailMeta.length === 0) {
    response.json({ threads: [], personEmails: [], connectedUsers: [] });
    return;
  }

  try {
    // Fetch from all connected Gmail accounts in parallel, tag each thread with source
    const emailToPersonId = new Map(personEmailMeta.map((p) => [p.email.toLowerCase(), p.personId]));
    const allThreadResults = await Promise.all(
      allTokens.map(async (tokenRecord) => {
        try {
          const threads = await getInboxThreads(tokenRecord.accessToken, tokenRecord.refreshToken, personEmailMeta);
          return threads.map((t) => ({
            ...t,
            personId: emailToPersonId.get(t.personEmail.toLowerCase()),
            sourceUserEmail: tokenRecord.userEmail,
            sourceUserName: memberNameMap.get(tokenRecord.userEmail) ?? tokenRecord.userEmail,
          }));
        } catch {
          return [];
        }
      }),
    );

    // Merge all threads (no global dedup — frontend deduplicates for "All" view)
    // Each thread retains its sourceUserEmail so per-user filtering works correctly
    const merged = allThreadResults.flat();
    merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const memberPhotoMap = new Map(memberUserRecords.map((u) => [u.email, u.profilePhotoUrl ?? null]));
    const connectedUsers = allTokens.map((t) => ({
      email: t.userEmail,
      name: memberNameMap.get(t.userEmail) ?? t.userEmail,
      profilePhotoUrl: memberPhotoMap.get(t.userEmail) ?? null,
    }));

    response.json({ threads: merged, personEmails: personEmailMeta, connectedUsers });
  } catch (err) {
    console.error("[inbox] Failed:", err);
    response.status(500).json({ error: "Failed to fetch inbox" });
  }
});

// Get all messages in an inbox thread
app.get("/inbox/threads/:threadId", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const googleTokensCol = await getGoogleTokensCollection();

  // If sourceUserEmail specified, use that account's token; otherwise try all
  const sourceUserEmail = request.query.sourceUserEmail as string | undefined;
  const candidateEmails = sourceUserEmail
    ? [sourceUserEmail].filter((e) => memberEmails.includes(e))
    : memberEmails;

  const allTokens = await googleTokensCol
    .find({ userEmail: { $in: candidateEmails } })
    .toArray();

  for (const tokenRecord of allTokens) {
    try {
      const messages = await getThreadMessages(
        tokenRecord.accessToken,
        tokenRecord.refreshToken,
        request.params.threadId,
      );
      response.json({ messages, sourceUserEmail: tokenRecord.userEmail });
      return;
    } catch {
      continue;
    }
  }

  response.status(404).json({ error: "Thread not found" });
});

// Reply to an inbox thread
app.post("/inbox/threads/:threadId/reply", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const googleTokensCol = await getGoogleTokensCollection();

  const { to, subject, body, sourceUserEmail, inReplyTo } = request.body as {
    to: string;
    subject: string;
    body: string;
    sourceUserEmail?: string;
    inReplyTo?: string;
  };

  if (!to || !body) {
    response.status(400).json({ error: "to and body are required" });
    return;
  }

  const targetEmail = sourceUserEmail && memberEmails.includes(sourceUserEmail)
    ? sourceUserEmail
    : userEmail;

  const tokenRecord = await googleTokensCol.findOne({ userEmail: targetEmail });
  if (!tokenRecord) {
    response.status(403).json({ error: "Gmail not connected" });
    return;
  }

  try {
    await replyToThread(
      tokenRecord.accessToken,
      tokenRecord.refreshToken,
      request.params.threadId,
      to,
      subject ?? "",
      body,
      inReplyTo,
    );
    response.json({ success: true });
  } catch (err) {
    console.error("[inbox-reply] Failed:", err);
    response.status(500).json({ error: "Failed to send reply" });
  }
});

// Mark an inbox thread as read
app.post("/inbox/threads/:threadId/read", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const googleTokensCol = await getGoogleTokensCollection();

  const { sourceUserEmail } = request.body as { sourceUserEmail?: string };

  const targetEmail = sourceUserEmail && memberEmails.includes(sourceUserEmail)
    ? sourceUserEmail
    : userEmail;

  const tokenRecord = await googleTokensCol.findOne({ userEmail: targetEmail });
  if (!tokenRecord) {
    response.status(403).json({ error: "Gmail not connected" });
    return;
  }

  try {
    await markThreadAsRead(tokenRecord.accessToken, tokenRecord.refreshToken, request.params.threadId);
    response.json({ success: true });
  } catch (err) {
    console.error("[inbox-mark-read] Failed:", err);
    response.status(500).json({ error: "Failed to mark as read" });
  }
});

// Get calendar events — aggregated from all workspace members with Calendar connected
app.get("/calendar/events", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const googleTokensCol = await getGoogleTokensCollection();
  const personsCol = await getPersonsCollection();
  const usersCol = await getUsersCollection();

  // Member name map + sharing eligibility
  const memberUserRecords = await usersCol.find({ email: { $in: memberEmails } }).toArray();
  const memberNameMap = new Map(memberUserRecords.map((u) => [u.email, u.fullName ?? u.email]));

  // Only use tokens from members who have sharing enabled (or are the requester themselves)
  // Also respect the calendarConnected flag
  const calSelf = memberUserRecords.find((m) => m.email === userEmail);
  const sharingEnabledEmails = new Set<string>();
  if (calSelf?.calendarConnected !== false) sharingEnabledEmails.add(userEmail);
  for (const m of memberUserRecords) {
    if (m.email !== userEmail && m.shareWithWorkspace !== false && m.calendarConnected !== false) sharingEnabledEmails.add(m.email);
  }

  const allTokens = await googleTokensCol.find({ userEmail: { $in: [...sharingEnabledEmails] } }).toArray();
  if (allTokens.length === 0) {
    response.status(403).json({ error: "Google not connected" });
    return;
  }

  // Default: covers the requested month
  const now = new Date();
  const timeMin = (request.query.timeMin as string) ?? new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const timeMax = (request.query.timeMax as string) ?? new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();

  // Build email → person map for attendee matching (workspace-wide)
  const allPersons = await personsCol.find({ userEmails: { $in: memberEmails }, enrichmentStatus: "completed" }).toArray();
  type PersonMeta = { personId: string; name: string; title?: string; companyName?: string; companyDomain?: string; profilePic?: string };
  const emailToPersonMap = new Map<string, PersonMeta>();
  for (const person of allPersons) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (person.enrichmentData as any)?.output?.data?.[0];
    const nameParts = [data?.first_name, data?.last_name].filter(Boolean);
    const name = data?.name ?? (nameParts.length > 0 ? nameParts.join(" ") : "Unknown");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentJob = data?.current_job as Record<string, any> | undefined;
    const title: string | undefined = currentJob?.title ?? undefined;
    const companyName: string | undefined = currentJob?.company_name ?? data?.company ?? undefined;
    const companyDomain: string | undefined = person.companyDomain ?? data?.company_domain ?? undefined;
    const profilePic: string | undefined = data?.profile_pic ?? undefined;
    const meta: PersonMeta = { personId: person._id!.toHexString(), name, title, companyName, companyDomain, profilePic };

    // Register all known emails for this person
    const emails = new Set<string>();
    if (person.workEmail) emails.add(person.workEmail.toLowerCase());
    if (data?.work_email) emails.add((data.work_email as string).toLowerCase());
    if (Array.isArray(data?.emails)) {
      for (const e of data.emails) {
        if (typeof e === "string") emails.add(e.toLowerCase());
      }
    }
    if (data?.personal_email) emails.add((data.personal_email as string).toLowerCase());
    for (const e of emails) {
      if (!emailToPersonMap.has(e)) emailToPersonMap.set(e, meta);
    }
  }

  try {
    // Fetch from all connected accounts in parallel
    const allResults = await Promise.all(
      allTokens.map(async (tokenRecord) => {
        try {
          const events = await getCalendarEvents(tokenRecord.accessToken, tokenRecord.refreshToken, timeMin, timeMax);
          return events.map((event) => {
            const matchedPersons = event.attendees
              .map((a) => {
                const match = emailToPersonMap.get(a.email.toLowerCase());
                return match ? { personId: match.personId, name: match.name, email: a.email } : null;
              })
              .filter(Boolean);
            return {
              ...event,
              matchedPersons,
              sourceUserEmail: tokenRecord.userEmail,
              sourceUserName: memberNameMap.get(tokenRecord.userEmail) ?? tokenRecord.userEmail,
            };
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const isPermission =
            msg.includes("insufficient") ||
            msg.includes("insufficientPermissions") ||
            msg.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
            (err as { code?: number }).code === 403;
          if (isPermission && tokenRecord.userEmail === userEmail) {
            throw Object.assign(new Error("needs_calendar_permission"), { isPermission: true });
          }
          return [];
        }
      }),
    );

    // Merge all events (no global dedup — frontend deduplicates for "All" view)
    const merged = allResults.flat();
    merged.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

    const memberPhotoMap = new Map(memberUserRecords.map((u) => [u.email, u.profilePhotoUrl ?? null]));
    const connectedUsers = allTokens.map((t) => ({
      email: t.userEmail,
      name: memberNameMap.get(t.userEmail) ?? t.userEmail,
      profilePhotoUrl: memberPhotoMap.get(t.userEmail) ?? null,
    }));

    response.json({ events: merged, connectedUsers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isPermission = msg === "needs_calendar_permission";
    console.error("[calendar] Failed:", msg);
    response
      .status(isPermission ? 403 : 500)
      .json({ error: isPermission ? "needs_calendar_permission" : "Failed to fetch calendar events" });
  }
});

// Get last 5 emails exchanged with a person
app.get("/persons/:id/emails", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const personsCol = await getPersonsCollection();
  const googleTokensCol = await getGoogleTokensCollection();

  let person;
  try {
    person = await personsCol.findOne({ _id: new ObjectId(request.params.id), userEmails: { $in: memberEmails } });
  } catch {
    response.status(400).json({ error: "Invalid person ID" });
    return;
  }
  if (!person) {
    response.status(404).json({ error: "Person not found" });
    return;
  }

  const tokenRecord = await googleTokensCol.findOne({ userEmail });
  if (!tokenRecord) {
    response.status(403).json({ error: "Gmail not connected" });
    return;
  }

  const personEmail = request.query.personEmail as string;
  if (!personEmail) {
    response.status(400).json({ error: "personEmail query param required" });
    return;
  }

  try {
    const emails = await getEmailsWithPerson(tokenRecord.accessToken, tokenRecord.refreshToken, personEmail);
    response.json({ emails });
  } catch (err) {
    console.error("[gmail-threads] Failed:", err);
    response.status(500).json({ error: "Failed to fetch emails" });
  }
});

// Re-enrich a person via Fiber using their LinkedIn URL (kitchen-sink/person)
app.post("/persons/:id/re-enrich", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const personsCol = await getPersonsCollection();

  let person;
  try {
    person = await personsCol.findOne({ _id: new ObjectId(request.params.id), userEmails: { $in: memberEmails } });
  } catch {
    response.status(400).json({ error: "Invalid person ID" });
    return;
  }
  if (!person) {
    response.status(404).json({ error: "Person not found" });
    return;
  }

  // Mark as pending while enriching
  await personsCol.updateOne(
    { _id: new ObjectId(request.params.id) },
    { $set: { enrichmentStatus: "pending" } },
  );

  const enrichment = await enrichPersonWithFiber(person.linkedinUrl);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let enrichmentPayload = enrichment.payload as any;

  if (enrichment.success) {
    try {
      const personData = enrichmentPayload?.output?.data?.[0];
      const hasEmail = !!(personData?.work_email ?? personData?.emails?.[0] ?? personData?.personal_email);
      const { companyDomain: domainFromFiber } = extractPersonFields(enrichmentPayload);
      if (!hasEmail && personData?.first_name && personData?.last_name && domainFromFiber) {
        const foundEmail = await findPersonEmailWithFiber(personData.first_name, personData.last_name, domainFromFiber);
        if (foundEmail) {
          enrichmentPayload = {
            ...enrichmentPayload,
            output: { ...enrichmentPayload.output, data: [{ ...personData, work_email: foundEmail }] },
          };
        }
      }
    } catch { /* ignore */ }

    const { workEmail, companyDomain } = extractPersonFields(enrichmentPayload);
    await personsCol.updateOne(
      { _id: new ObjectId(request.params.id) },
      {
        $set: {
          enrichedAt: new Date().toISOString(),
          enrichmentStatus: "completed",
          enrichmentData: enrichmentPayload,
          ...(workEmail ? { workEmail } : {}),
          ...(companyDomain ? { companyDomain } : {}),
        },
      },
    );
    if (companyDomain) await ensureCompany(companyDomain, userEmail);
  } else {
    await personsCol.updateOne(
      { _id: new ObjectId(request.params.id) },
      {
        $set: {
          enrichedAt: new Date().toISOString(),
          enrichmentStatus: "failed",
          enrichmentError: enrichment.error ?? "Fiber enrichment failed",
          enrichmentData: enrichmentPayload,
        },
      },
    );
  }

  const updatedPerson = await personsCol.findOne({ _id: new ObjectId(request.params.id) });
  response.json({ person: updatedPerson, enriched: enrichment.success });
});

// Find email for a person using Fiber (people-search + contact-enrich batch/poll)
app.post("/persons/:id/find-email", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const personsCol = await getPersonsCollection();

  let person;
  try {
    person = await personsCol.findOne({ _id: new ObjectId(request.params.id), userEmails: { $in: memberEmails } });
  } catch {
    response.status(400).json({ error: "Invalid person ID" });
    return;
  }
  if (!person) {
    response.status(404).json({ error: "Person not found" });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const personData = (person.enrichmentData as any)?.output?.data?.[0];
  const firstName = personData?.first_name as string | undefined;
  const lastName = personData?.last_name as string | undefined;
  const { companyDomain } = extractPersonFields(person.enrichmentData ?? {});

  let foundEmail: string | null = null;

  // Strategy 1: contact-details/sync by LinkedIn URL (primary)
  if (person.linkedinUrl) {
    const result = await findEmailWithContactDetails(person.linkedinUrl);
    foundEmail = result.email;
  }

  // Strategy 2: people-search by name + company domain (fallback)
  if (!foundEmail && firstName && lastName && companyDomain) {
    foundEmail = await findPersonEmailWithFiber(firstName, lastName, companyDomain);
  }

  if (!foundEmail) {
    response.json({ person, email: null, message: "Could not find email" });
    return;
  }

  // Store the found email in enrichmentData
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = (person.enrichmentData ?? { output: { data: [{}] } }) as any;
  const updatedEnrichmentData = {
    ...existing,
    output: {
      ...(existing.output ?? {}),
      data: [{ ...(existing.output?.data?.[0] ?? {}), work_email: foundEmail }],
    },
  };

  await personsCol.updateOne(
    { _id: new ObjectId(request.params.id) },
    { $set: { enrichmentData: updatedEnrichmentData, workEmail: foundEmail } },
  );

  const updatedPerson = await personsCol.findOne({ _id: new ObjectId(request.params.id) });
  response.json({ person: updatedPerson, email: foundEmail });
});

// Save a manually-provided email for a person (no Fiber call needed)
app.post("/persons/:id/set-email", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const { email } = request.body as { email: string };

  if (!email) {
    response.status(400).json({ error: "email is required" });
    return;
  }

  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const personsCol = await getPersonsCollection();

  let person;
  try {
    person = await personsCol.findOne({ _id: new ObjectId(request.params.id), userEmails: { $in: memberEmails } });
  } catch {
    response.status(400).json({ error: "Invalid person ID" });
    return;
  }
  if (!person) {
    response.status(404).json({ error: "Person not found" });
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = (person.enrichmentData ?? { output: { data: [{}] } }) as any;
  const updatedEnrichmentData = {
    ...existing,
    output: {
      ...(existing.output ?? {}),
      data: [{ ...(existing.output?.data?.[0] ?? {}), work_email: email }],
    },
  };

  await personsCol.updateOne(
    { _id: new ObjectId(request.params.id) },
    { $set: { enrichmentData: updatedEnrichmentData } },
  );

  const updatedPerson = await personsCol.findOne({ _id: new ObjectId(request.params.id) });
  response.json({ person: updatedPerson });
});

// Send an email to a person
app.post("/persons/:id/emails", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const memberEmails = await getWorkspaceMemberEmails(userEmail);
  const personsCol = await getPersonsCollection();
  const googleTokensCol = await getGoogleTokensCollection();

  let person;
  try {
    person = await personsCol.findOne({ _id: new ObjectId(request.params.id), userEmails: { $in: memberEmails } });
  } catch {
    response.status(400).json({ error: "Invalid person ID" });
    return;
  }
  if (!person) {
    response.status(404).json({ error: "Person not found" });
    return;
  }

  const tokenRecord = await googleTokensCol.findOne({ userEmail });
  if (!tokenRecord) {
    response.status(403).json({ error: "Gmail not connected" });
    return;
  }

  const { to, subject, body } = request.body as { to: string; subject: string; body: string };
  if (!to || !subject || !body) {
    response.status(400).json({ error: "to, subject, and body are required" });
    return;
  }

  try {
    await sendGmail(tokenRecord.accessToken, tokenRecord.refreshToken, to, subject, body);
    response.json({ success: true });
  } catch (err) {
    console.error("[gmail-send] Failed:", err);
    response.status(500).json({ error: "Failed to send email" });
  }
});

/* ------------------------------------------------------------------ */
/*  Export for serverless (Vercel)                                       */
/* ------------------------------------------------------------------ */

export default app;

/* ------------------------------------------------------------------ */
/*  Start server + workers (non-serverless)                              */
/* ------------------------------------------------------------------ */

if (!process.env.VERCEL) {
  app.listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT}`);
    console.log("dev deployment trigger");

    // Start BullMQ worker and cron scheduler
    try {
      startTriggersWorker();
      scheduleTriggersCron();
    } catch (err) {
      console.warn("[triggers] Could not start worker/cron (Redis may not be available):", err);
    }
  });
}

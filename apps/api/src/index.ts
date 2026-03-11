import cors from "cors";
import express from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getBuyerProfilesCollection, getLeadsCollection, getPersonsCollection, getSignalsCollection, getSkillJobsCollection, getSkillsCollection } from "./db.js";
import { env } from "./env.js";
import { getEmailFromToken, requestOtp, verifyOtp } from "./auth.js";
import { enrichDomainWithFiber, enrichPersonWithFiber, searchBuyersWithFiber } from "./fiber.js";
import { startSkillsWorker, scheduleSkillsCron, triggerSkillsProcessing } from "./skills-worker.js";

const app = express();

app.use(
  cors({
    origin: env.ALLOWED_ORIGIN,
  }),
);
app.use(express.json());

const emailSchema = z.object({
  email: z.string().email(),
});

const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().min(4),
});

const createLeadSchema = z.object({
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
});

function sanitizeDomain(rawDomain: string): string {
  return rawDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
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

app.post("/auth/request-code", (request, response) => {
  const result = emailSchema.safeParse(request.body);
  if (!result.success) {
    response.status(400).json({ error: "Invalid email" });
    return;
  }

  requestOtp(result.data.email);
  response.json({
    message: "OTP generated. Use 7777 for now.",
  });
});

app.post("/auth/verify-code", (request, response) => {
  const result = verifySchema.safeParse(request.body);
  if (!result.success) {
    response.status(400).json({ error: "Invalid input" });
    return;
  }

  const token = verifyOtp(result.data.email, result.data.code);
  if (!token) {
    response.status(401).json({ error: "Invalid code or email" });
    return;
  }

  response.json({ token });
});

app.use((request, response, next) => {
  console.log("[auth-middleware] %s %s", request.method, request.path);
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

app.get("/me", (_request, response) => {
  const email = response.locals.userEmail as string;
  response.json({ email });
});

app.get("/leads", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const leadsCollection = await getLeadsCollection();
  const leads = await leadsCollection.find({ userEmails: userEmail }).sort({ createdAt: -1 }).toArray();
  response.json({ leads });
});

app.get("/leads/by-domain/:domain", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const leadsCollection = await getLeadsCollection();
  const lead = await leadsCollection.findOne({ domain: request.params.domain, userEmails: userEmail });
  if (!lead) {
    response.status(404).json({ error: "Lead not found" });
    return;
  }
  response.json({ lead });
});

app.get("/leads/:id", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const leadsCollection = await getLeadsCollection();
  let lead;
  try {
    lead = await leadsCollection.findOne({ _id: new ObjectId(request.params.id), userEmails: userEmail });
  } catch {
    response.status(400).json({ error: "Invalid lead ID" });
    return;
  }
  if (!lead) {
    response.status(404).json({ error: "Lead not found" });
    return;
  }
  response.json({ lead });
});

app.get("/leads/:id/persons", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const leadsCollection = await getLeadsCollection();
  let lead;
  try {
    lead = await leadsCollection.findOne({ _id: new ObjectId(request.params.id), userEmails: userEmail });
  } catch {
    response.status(400).json({ error: "Invalid lead ID" });
    return;
  }
  if (!lead) {
    response.status(404).json({ error: "Lead not found" });
    return;
  }
  const personsCollection = await getPersonsCollection();
  const persons = await personsCollection.find({ companyDomain: lead.domain, userEmails: userEmail }).sort({ createdAt: -1 }).toArray();
  response.json({ persons });
});

app.post("/leads", async (request, response) => {
  const parsed = createLeadSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Please provide a valid domain" });
    return;
  }

  const userEmail = response.locals.userEmail as string;
  const domain = sanitizeDomain(parsed.data.domain);
  const leadsCollection = await getLeadsCollection();

  // Check if this user already has this lead
  const existingForUser = await leadsCollection.findOne({ domain, userEmails: userEmail });
  if (existingForUser) {
    response.status(409).json({ error: "Lead already exists", lead: existingForUser });
    return;
  }

  // Check if the lead exists but belongs to other users — just add the association
  const existingLead = await leadsCollection.findOne({ domain });
  if (existingLead) {
    await leadsCollection.updateOne(
      { _id: existingLead._id },
      { $addToSet: { userEmails: userEmail } },
    );
    const updatedLead = await leadsCollection.findOne({ _id: existingLead._id });
    response.status(201).json({ lead: updatedLead });
    return;
  }

  // New domain — create lead and enrich
  const createdAt = new Date().toISOString();
  const insertResult = await leadsCollection.insertOne({
    userEmails: [userEmail],
    domain,
    createdAt,
    enrichmentStatus: "pending",
  });

  const leadId = insertResult.insertedId;
  const enrichment = await enrichDomainWithFiber(domain);

  if (enrichment.success) {
    await leadsCollection.updateOne(
      { _id: leadId },
      {
        $set: {
          enrichedAt: new Date().toISOString(),
          enrichmentStatus: "completed",
          enrichmentData: enrichment.payload,
        },
      },
    );
  } else {
    await leadsCollection.updateOne(
      { _id: leadId },
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

  const savedLead = await leadsCollection.findOne({ _id: leadId });
  response.status(201).json({ lead: savedLead });
});

app.delete("/leads/:id", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const leadsCollection = await getLeadsCollection();

  let result;
  try {
    result = await leadsCollection.updateOne(
      { _id: new ObjectId(request.params.id), userEmails: userEmail },
      { $pull: { userEmails: userEmail } },
    );
  } catch {
    response.status(400).json({ error: "Invalid lead ID" });
    return;
  }

  if (result.matchedCount === 0) {
    response.status(404).json({ error: "Lead not found" });
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
  const personsCollection = await getPersonsCollection();
  const persons = await personsCollection.find({ userEmails: userEmail }).sort({ createdAt: -1 }).toArray();
  response.json({ persons });
});

app.get("/persons/:id", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const personsCollection = await getPersonsCollection();
  let person;
  try {
    person = await personsCollection.findOne({ _id: new ObjectId(request.params.id), userEmails: userEmail });
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

app.post("/persons", async (request, response) => {
  const parsed = createPersonSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Please provide a valid LinkedIn profile URL" });
    return;
  }

  const userEmail = response.locals.userEmail as string;
  const linkedinUrl = normalizeLinkedinUrl(parsed.data.linkedinUrl);
  const personsCollection = await getPersonsCollection();

  const existingForUser = await personsCollection.findOne({ linkedinUrl, userEmails: userEmail });
  if (existingForUser) {
    response.status(409).json({ error: "Person already exists", person: existingForUser });
    return;
  }

  const existingPerson = await personsCollection.findOne({ linkedinUrl });
  if (existingPerson) {
    await personsCollection.updateOne(
      { _id: existingPerson._id },
      { $addToSet: { userEmails: userEmail } },
    );
    const updatedPerson = await personsCollection.findOne({ _id: existingPerson._id });
    response.status(201).json({ person: updatedPerson });
    return;
  }

  const createdAt = new Date().toISOString();
  const insertResult = await personsCollection.insertOne({
    userEmails: [userEmail],
    linkedinUrl,
    createdAt,
    enrichmentStatus: "pending",
  });

  const personId = insertResult.insertedId;
  const enrichment = await enrichPersonWithFiber(linkedinUrl);

  // Extract company domain from enrichment data
  let companyDomain: string | undefined;
  if (enrichment.success) {
    try {
      const personData = (enrichment.payload as any)?.output?.data?.[0];
      const currentJob = personData?.current_job;
      // Try company_domain first, then fall back to company_website_domain
      companyDomain = currentJob?.company_domain ?? currentJob?.company_website_domain ?? undefined;
      if (companyDomain) {
        companyDomain = sanitizeDomain(companyDomain);
      }
    } catch {
      // Ignore extraction errors
    }

    await personsCollection.updateOne(
      { _id: personId },
      {
        $set: {
          enrichedAt: new Date().toISOString(),
          enrichmentStatus: "completed",
          enrichmentData: enrichment.payload,
          ...(companyDomain ? { companyDomain } : {}),
        },
      },
    );
  } else {
    await personsCollection.updateOne(
      { _id: personId },
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

  // Auto-enrich the company if we found a domain
  if (companyDomain) {
    const leadsCollection = await getLeadsCollection();
    const existingLead = await leadsCollection.findOne({ domain: companyDomain });
    if (existingLead) {
      // Just add user association if not already present
      await leadsCollection.updateOne(
        { _id: existingLead._id },
        { $addToSet: { userEmails: userEmail } },
      );
    } else {
      // Create and enrich the company
      const leadInsert = await leadsCollection.insertOne({
        userEmails: [userEmail],
        domain: companyDomain,
        createdAt: new Date().toISOString(),
        enrichmentStatus: "pending",
      });
      const companyEnrichment = await enrichDomainWithFiber(companyDomain);
      if (companyEnrichment.success) {
        await leadsCollection.updateOne(
          { _id: leadInsert.insertedId },
          {
            $set: {
              enrichedAt: new Date().toISOString(),
              enrichmentStatus: "completed",
              enrichmentData: companyEnrichment.payload,
            },
          },
        );
      } else {
        await leadsCollection.updateOne(
          { _id: leadInsert.insertedId },
          {
            $set: {
              enrichedAt: new Date().toISOString(),
              enrichmentStatus: "failed",
              enrichmentError: companyEnrichment.error ?? "Fiber enrichment failed",
              enrichmentData: companyEnrichment.payload,
            },
          },
        );
      }
    }
  }

  const savedPerson = await personsCollection.findOne({ _id: personId });
  response.status(201).json({ person: savedPerson });
});

app.delete("/persons/:id", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const personsCollection = await getPersonsCollection();

  let result;
  try {
    result = await personsCollection.updateOne(
      { _id: new ObjectId(request.params.id), userEmails: userEmail },
      { $pull: { userEmails: userEmail } },
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
  const collection = await getBuyerProfilesCollection();
  const profiles = await collection.find({ userEmail }).sort({ createdAt: -1 }).toArray();
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

app.post("/leads/:id/find-buyers", async (request, response) => {
  const parsed = findBuyersSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Please provide a buyer profile ID" });
    return;
  }

  const userEmail = response.locals.userEmail as string;

  // Get the lead
  const leadsCollection = await getLeadsCollection();
  let lead;
  try {
    lead = await leadsCollection.findOne({ _id: new ObjectId(request.params.id), userEmails: userEmail });
  } catch {
    response.status(400).json({ error: "Invalid lead ID" });
    return;
  }
  if (!lead) {
    response.status(404).json({ error: "Lead not found" });
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

  // Search Fiber
  const result = await searchBuyersWithFiber(lead.domain, buyerProfile.titles, parsed.data.cursor ?? null);

  if (!result.success) {
    response.status(502).json({ error: result.error ?? "Fiber search failed" });
    return;
  }

  response.json({ result: result.payload });
});

/* ------------------------------------------------------------------ */
/*  Skills endpoints                                                     */
/* ------------------------------------------------------------------ */

const createSkillSchema = z.object({
  skillType: z.enum(["linkedin_content"]),
  keyword: z.string().nullable().optional(),
});

const updateSkillSchema = z.object({
  keyword: z.string().nullable().optional(),
  status: z.enum(["active", "paused"]).optional(),
});

app.get("/skills", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const collection = await getSkillsCollection();
  const skills = await collection.find({ userEmail }).sort({ createdAt: -1 }).toArray();
  response.json({ skills });
});

app.post("/skills", async (request, response) => {
  const parsed = createSkillSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid skill configuration" });
    return;
  }

  const userEmail = response.locals.userEmail as string;
  const skillsCol = await getSkillsCollection();

  // Check if skill already exists for this user
  const existing = await skillsCol.findOne({ userEmail, skillType: parsed.data.skillType });
  if (existing) {
    response.status(409).json({ error: "Skill already enabled", skill: existing });
    return;
  }

  const now = new Date().toISOString();
  const insertResult = await skillsCol.insertOne({
    userEmail,
    skillType: parsed.data.skillType,
    config: { keyword: parsed.data.keyword ?? null },
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  const skillId = insertResult.insertedId;

  // Create SkillJob entries for all persons this user tracks
  const personsCol = await getPersonsCollection();
  const persons = await personsCol.find({ userEmails: userEmail }).toArray();
  const skillJobsCol = await getSkillJobsCollection();

  if (persons.length > 0) {
    const jobDocs = persons.map((person) => ({
      skillId,
      userEmail,
      jobType: "LinkedinPost" as const,
      personId: person._id!,
      linkedinUrl: person.linkedinUrl,
      status: "pending" as const,
      createdAt: now,
    }));

    await skillJobsCol.insertMany(jobDocs);
  }

  const skill = await skillsCol.findOne({ _id: skillId });
  response.status(201).json({ skill, jobsCreated: persons.length });
});

app.put("/skills/:id", async (request, response) => {
  const parsed = updateSkillSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "Invalid input" });
    return;
  }

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

  const updateFields: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (parsed.data.keyword !== undefined) updateFields["config.keyword"] = parsed.data.keyword;
  if (parsed.data.status !== undefined) updateFields.status = parsed.data.status;

  await skillsCol.updateOne({ _id: skill._id }, { $set: updateFields });

  const updated = await skillsCol.findOne({ _id: skill._id });
  response.json({ skill: updated });
});

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

  // Delete the skill and all associated jobs
  const skillJobsCol = await getSkillJobsCollection();
  await skillJobsCol.deleteMany({ skillId: skill._id });
  await skillsCol.deleteOne({ _id: skill._id });

  response.json({ success: true });
});

// Manually trigger processing (for testing)
app.post("/skills/trigger-processing", async (_request, response) => {
  const count = await triggerSkillsProcessing();
  response.json({ success: true, jobsEnqueued: count });
});

/* ------------------------------------------------------------------ */
/*  Signals endpoints                                                    */
/* ------------------------------------------------------------------ */

app.get("/signals", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const signalsCol = await getSignalsCollection();

  const limit = Math.min(parseInt(request.query.limit as string) || 50, 100);
  const offset = parseInt(request.query.offset as string) || 0;

  const [signals, total] = await Promise.all([
    signalsCol.find({ userEmail }).sort({ createdAt: -1 }).skip(offset).limit(limit).toArray(),
    signalsCol.countDocuments({ userEmail }),
  ]);

  response.json({ signals, total, limit, offset });
});

app.delete("/signals/:id", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const signalsCol = await getSignalsCollection();

  let result;
  try {
    result = await signalsCol.deleteOne({ _id: new ObjectId(request.params.id), userEmail });
  } catch {
    response.status(400).json({ error: "Invalid signal ID" });
    return;
  }

  if (result.deletedCount === 0) {
    response.status(404).json({ error: "Signal not found" });
    return;
  }

  response.json({ success: true });
});

/* ------------------------------------------------------------------ */
/*  Start server + workers                                               */
/* ------------------------------------------------------------------ */

app.listen(env.PORT, () => {
  console.log(`API listening on http://localhost:${env.PORT}`);

  // Start BullMQ worker and cron scheduler
  try {
    startSkillsWorker();
    scheduleSkillsCron();
  } catch (err) {
    console.warn("[skills] Could not start worker/cron (Redis may not be available):", err);
  }
});

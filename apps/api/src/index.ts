import cors from "cors";
import express from "express";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getBuyerProfilesCollection, getBuyerSearchResultsCollection, getCompanyATSCollection, getCompaniesCollection, getJobsCollection, getPersonsCollection, getSignalsCollection, getTriggerJobsCollection, getTriggersCollection } from "./db.js";
import { env } from "./env.js";
import { getEmailFromToken, requestOtp, verifyOtp } from "./auth.js";
import { enrichDomainWithFiber, enrichPersonWithFiber, searchBuyersWithFiber } from "./fiber.js";
import { startTriggersWorker, scheduleTriggersCron, triggerTriggersProcessing, createPendingJobs, enqueuePendingJobsForUser, enqueueSpecificJob } from "./triggers-worker.js";
import { detectCompanyATS } from "./firecrawl.js";

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

app.get("/companies", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const companiesCollection = await getCompaniesCollection();
  const companies = await companiesCollection.find({ userEmails: userEmail }).sort({ createdAt: -1 }).toArray();
  response.json({ companies });
});

app.get("/companies/by-domain/:domain", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const companiesCollection = await getCompaniesCollection();
  const company = await companiesCollection.findOne({ domain: request.params.domain, userEmails: userEmail });
  if (!company) {
    response.status(404).json({ error: "Company not found" });
    return;
  }
  response.json({ company });
});

app.get("/companies/:id", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const companiesCollection = await getCompaniesCollection();
  let company;
  try {
    company = await companiesCollection.findOne({ _id: new ObjectId(request.params.id), userEmails: userEmail });
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
  const companiesCollection = await getCompaniesCollection();
  let company;
  try {
    company = await companiesCollection.findOne({ _id: new ObjectId(request.params.id), userEmails: userEmail });
  } catch {
    response.status(400).json({ error: "Invalid company ID" });
    return;
  }
  if (!company) {
    response.status(404).json({ error: "Company not found" });
    return;
  }
  const personsCollection = await getPersonsCollection();
  const persons = await personsCollection.find({ companyDomain: company.domain, userEmails: userEmail }).sort({ createdAt: -1 }).toArray();
  response.json({ persons });
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

  // Check if this user already has this company
  const existingForUser = await companiesCollection.findOne({ domain, userEmails: userEmail });
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

  const savedCompany = await companiesCollection.findOne({ _id: companyId });
  response.status(201).json({ company: savedCompany });
});

app.delete("/companies/:id", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const companiesCollection = await getCompaniesCollection();

  let result;
  try {
    result = await companiesCollection.updateOne(
      { _id: new ObjectId(request.params.id), userEmails: userEmail },
      { $pull: { userEmails: userEmail } },
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
    const companiesCollection = await getCompaniesCollection();
    const existingCompany = await companiesCollection.findOne({ domain: companyDomain });
    if (existingCompany) {
      // Just add user association if not already present
      await companiesCollection.updateOne(
        { _id: existingCompany._id },
        { $addToSet: { userEmails: userEmail } },
      );
    } else {
      // Create and enrich the company
      const companyInsert = await companiesCollection.insertOne({
        userEmails: [userEmail],
        domain: companyDomain,
        createdAt: new Date().toISOString(),
        enrichmentStatus: "pending",
      });
      const companyEnrichment = await enrichDomainWithFiber(companyDomain);
      if (companyEnrichment.success) {
        await companiesCollection.updateOne(
          { _id: companyInsert.insertedId },
          {
            $set: {
              enrichedAt: new Date().toISOString(),
              enrichmentStatus: "completed",
              enrichmentData: companyEnrichment.payload,
            },
          },
        );
      } else {
        await companiesCollection.updateOne(
          { _id: companyInsert.insertedId },
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
    company = await companiesCollection.findOne({ _id: new ObjectId(request.params.id), userEmails: userEmail });
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
    // Load more — append to existing cache
    await cache.updateOne(
      { companyId: companyObjectId, buyerProfileId: buyerProfileObjectId, userEmail },
      { $push: { buyers: { $each: newBuyers } }, $set: { nextCursor } },
    );
  } else {
    // Fresh search — replace cache
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

  response.json({ result: result.payload });
});

/* ------------------------------------------------------------------ */
/*  Company ATS Detection endpoints                                    */
/* ------------------------------------------------------------------ */

// GET ATS information for a company
app.get("/companies/:id/ats", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const companiesCollection = await getCompaniesCollection();

  let company;
  try {
    company = await companiesCollection.findOne({ _id: new ObjectId(request.params.id), userEmails: userEmail });
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
  const companiesCollection = await getCompaniesCollection();

  let company;
  try {
    company = await companiesCollection.findOne({ _id: new ObjectId(request.params.id), userEmails: userEmail });
  } catch {
    response.status(400).json({ error: "Invalid company ID" });
    return;
  }

  if (!company) {
    response.status(404).json({ error: "Company not found" });
    return;
  }

  const atsCollection = await getCompanyATSCollection();
  const companyId = company._id!;

  // Check if detection already exists
  const existing = await atsCollection.findOne({ companyId });
  if (existing) {
    response.json({ ats: existing, message: "ATS already detected" });
    return;
  }

  // Create pending record
  const createdAt = new Date().toISOString();
  await atsCollection.insertOne({
    companyId,
    domain: company.domain,
    detectedAt: createdAt,
    detectionStatus: "pending",
  });

  // Detect ATS
  const detection = await detectCompanyATS(company.domain);

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
  }

  const updated = await atsCollection.findOne({ companyId });

  // If ATS was successfully detected with a careerPageUrl, create an ATSJobs trigger job
  // for any active ats_jobs trigger this user has
  if (detection.success && detection.data?.careerPageURL) {
    try {
      const triggersCol = await getTriggersCollection();
      const atsJobsTrigger = await triggersCol.findOne({ userEmail, triggerType: "ats_jobs", status: "active" });

      if (atsJobsTrigger) {
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
        } catch {
          // Already exists — ignore
        }
      }
    } catch {
      // Non-critical — don't fail the request
    }
  }

  response.json({ ats: updated });
});

/* ------------------------------------------------------------------ */
/*  Jobs endpoints                                                       */
/* ------------------------------------------------------------------ */

// GET all jobs for a company
app.get("/companies/:id/jobs", async (request, response) => {
  const userEmail = response.locals.userEmail as string;
  const companiesCollection = await getCompaniesCollection();

  let company;
  try {
    company = await companiesCollection.findOne({ _id: new ObjectId(request.params.id), userEmails: userEmail });
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
});

const updateTriggerSchema = z.object({
  keyword: z.string().nullable().optional(),
  status: z.enum(["active", "paused"]).optional(),
});

app.get("/triggers", async (_request, response) => {
  const userEmail = response.locals.userEmail as string;
  const collection = await getTriggersCollection();
  const triggers = await collection.find({ userEmail }).sort({ createdAt: -1 }).toArray();
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
    config: { keyword: parsed.data.keyword ?? null },
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
      await triggerJobsCol.insertMany(jobDocs);
      jobsCreated = persons.length;
    }
  } else if (parsed.data.triggerType === "ats_jobs") {
    // Create TriggerJob entries for all companies with ATS detected and careerPageUrl set
    const companiesCol = await getCompaniesCollection();
    const atsCol = await getCompanyATSCollection();

    const userCompanies = await companiesCol.find({ userEmails: userEmail }).toArray();
    const companyIds = userCompanies.map((c) => c._id!);

    if (companyIds.length > 0) {
      const atsRecords = await atsCol
        .find({ companyId: { $in: companyIds }, detectionStatus: "completed", careerPageUrl: { $ne: null } })
        .toArray();

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
    startTriggersWorker();
    scheduleTriggersCron();
  } catch (err) {
    console.warn("[triggers] Could not start worker/cron (Redis may not be available):", err);
  }
});

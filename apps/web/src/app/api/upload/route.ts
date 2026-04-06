import { NextRequest, NextResponse } from "next/server";

const IMAGEKIT_PRIVATE_KEY = process.env.IMAGEKIT_PRIVATE_KEY ?? "private_kOS77M+E2hsFTUwxjL0JD4Y/atI=";
const IMAGEKIT_UPLOAD_URL = "https://upload.imagekit.io/api/v1/files/upload";

function getFolder(): string {
  return process.env.NODE_ENV === "production" ? "sidr/sidr-prod" : "sidr/sidr-np";
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const fileName = (formData.get("fileName") as string | null) ?? "upload";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Validate file type
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image files are allowed" }, { status: 400 });
  }

  // Validate file size (5MB max)
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "File must be under 5MB" }, { status: 400 });
  }

  const ikForm = new FormData();
  ikForm.append("file", file);
  ikForm.append("fileName", fileName);
  ikForm.append("folder", getFolder());
  ikForm.append("useUniqueFileName", "true");

  const res = await fetch(IMAGEKIT_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${IMAGEKIT_PRIVATE_KEY}:`).toString("base64")}`,
    },
    body: ikForm,
  });

  const data = (await res.json()) as { url?: string; message?: string };
  if (!res.ok) {
    return NextResponse.json({ error: data.message ?? "Upload failed" }, { status: res.status });
  }

  return NextResponse.json({ url: data.url });
}

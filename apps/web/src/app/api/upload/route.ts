import { NextRequest, NextResponse } from "next/server";

const IMAGEKIT_PRIVATE_KEY = "private_RMZWFhj6Jes/5vlWZLZs28n+18k=";
const IMAGEKIT_UPLOAD_URL = "https://upload.imagekit.io/api/v1/files/upload";

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const fileName = (formData.get("fileName") as string | null) ?? "upload";

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const ikForm = new FormData();
  ikForm.append("file", file);
  ikForm.append("fileName", fileName);
  ikForm.append("folder", "sidr-np");

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

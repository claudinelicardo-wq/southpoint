import { createAdminClient } from "@/lib/supabase/admin";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { NextResponse } from "next/server";

const BUCKET = "expense-receipts";
const MAX_BYTES = 4_000_000; // client downscales first; this is a hard backstop

/**
 * Uploads an expense receipt photo to Supabase Storage and returns its public
 * URL (stored on the expense row as receipt_url). Service-role client so no
 * storage RLS policies are needed; the bucket is created on first use.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (
    !session ||
    session.preview ||
    !can(session.permissions, session.profile.role, "expenses.manage")
  ) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image files are accepted." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image too large (max 4 MB)." }, { status: 400 });
  }

  const admin = createAdminClient();

  // Idempotent bucket setup — createBucket errors harmlessly if it exists.
  await admin.storage
    .createBucket(BUCKET, { public: true, fileSizeLimit: MAX_BYTES })
    .catch(() => {});

  const ext = file.type === "image/png" ? "png" : "jpg";
  const path = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${ext}`;
  const { error } = await admin.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: "31536000",
  });
  if (error) {
    return NextResponse.json({ error: "Upload failed. Try again." }, { status: 500 });
  }

  const { data } = admin.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: data.publicUrl });
}

import { NextResponse } from "next/server";

import { saveBusinessProfile } from "../../../../lib/db/mockProfileStore";
import { businessProfileSchema } from "../../../../lib/validators/businessProfile";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = businessProfileSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          message: "Invalid business profile payload",
          issues: parsed.error.flatten(),
        },
        { status: 400 }
      );
    }

    const userId = request.headers.get("x-user-id") ?? "default-user";
    const profile = saveBusinessProfile(userId, parsed.data);

    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: "Failed to save business profile" },
      { status: 500 }
    );
  }
}

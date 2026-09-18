import { guard } from "@/lib/server/auth";
import { putSetting } from "@/lib/server/db";
import { encrypt } from "@/lib/server/crypto";
import { z } from "zod";
export async function POST(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const data = z
      .object({
        clientId: z.string().trim().min(10).max(500),
        clientSecret: z.string().trim().min(10).max(500),
      })
      .parse(await request.json());
    await putSetting("google_config", encrypt(data));
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      {
        error:
          "Could not save the Google API settings. Check both OAuth fields and database availability.",
      },
      { status: 400 },
    );
  }
}

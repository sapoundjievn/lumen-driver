import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "../../../../lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const stripe = getStripe();
    let accountId = String(body.accountId || "");
    if (!accountId) {
      const acc = await stripe.accounts.create({
        type: "express",
        country: "US",
        email: body.email,
        capabilities: { transfers: { requested: true } },
        metadata: { driver_id: String(body.driverId || "") },
      });
      accountId = acc.id;
    }
    const origin = req.headers.get("origin") || "https://lumen-driver.vercel.app";
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: origin + "/?connect=refresh",
      return_url: origin + "/?connect=ok",
      type: "account_onboarding",
    });
    return NextResponse.json({ url: link.url, accountId });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

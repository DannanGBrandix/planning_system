import { NextResponse } from "next/server";

export async function GET() {
  return new NextResponse("// Service worker placeholder", {
    status: 200,
    headers: {
      "Content-Type": "application/javascript",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

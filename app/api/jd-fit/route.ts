import { handleJdFitRequest } from "../../lib/jdFit/http";

export async function POST(req: Request) {
  return handleJdFitRequest(req);
}

import {
  assertSameOriginMutation,
  experienceJson,
  getRouteSourceId,
  safeErrorResponse,
} from "../../../../lib/experience/apiRoutes";
import { indexExperienceRevision } from "../../../../lib/experience/apiService";

export async function POST(req: Request, context: { params: Promise<{ id?: string }> }) {
  try {
    assertSameOriginMutation(req);
    const sourceId = await getRouteSourceId(context);
    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    return experienceJson(await indexExperienceRevision(sourceId, body));
  } catch (error) {
    return safeErrorResponse(error);
  }
}

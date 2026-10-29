import {
  assertSameOriginMutation,
  experienceJson,
  getRouteSourceId,
  safeErrorResponse,
} from "../../../../lib/experience/apiRoutes";
import { parseExperienceSource } from "../../../../lib/experience/apiService";

export async function POST(req: Request, context: { params: { id?: string } | Promise<{ id?: string }> }) {
  try {
    assertSameOriginMutation(req);
    const sourceId = await getRouteSourceId(context);
    return experienceJson(await parseExperienceSource(sourceId));
  } catch (error) {
    return safeErrorResponse(error);
  }
}

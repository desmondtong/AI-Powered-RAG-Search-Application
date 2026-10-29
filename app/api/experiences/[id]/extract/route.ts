import {
  assertSameOriginMutation,
  experienceJson,
  getRouteSourceId,
  safeErrorResponse,
} from "../../../../lib/experience/apiRoutes";
import { extractExperienceSource } from "../../../../lib/experience/apiService";

export async function POST(req: Request, context: { params: Promise<{ id?: string }> }) {
  try {
    assertSameOriginMutation(req);
    const sourceId = await getRouteSourceId(context);
    return experienceJson(await extractExperienceSource(sourceId));
  } catch (error) {
    return safeErrorResponse(error);
  }
}

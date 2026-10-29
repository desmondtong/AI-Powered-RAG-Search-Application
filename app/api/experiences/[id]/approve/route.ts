import {
  assertSameOriginMutation,
  experienceJson,
  getRouteSourceId,
  safeErrorResponse,
} from "../../../../lib/experience/apiRoutes";
import { approveExperienceRevision } from "../../../../lib/experience/apiService";

export async function POST(req: Request, context: { params: Promise<{ id?: string }> }) {
  try {
    assertSameOriginMutation(req);
    const sourceId = await getRouteSourceId(context);
    return experienceJson(await approveExperienceRevision(sourceId, await req.json()));
  } catch (error) {
    return safeErrorResponse(error);
  }
}

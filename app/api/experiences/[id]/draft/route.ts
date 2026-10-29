import {
  assertSameOriginMutation,
  experienceJson,
  getRouteSourceId,
  safeErrorResponse,
} from "../../../../lib/experience/apiRoutes";
import { saveExperienceDraft } from "../../../../lib/experience/apiService";

export async function PATCH(req: Request, context: { params: { id?: string } | Promise<{ id?: string }> }) {
  try {
    assertSameOriginMutation(req);
    const sourceId = await getRouteSourceId(context);
    return experienceJson(await saveExperienceDraft(sourceId, await req.json()));
  } catch (error) {
    return safeErrorResponse(error);
  }
}

import {
  assertSameOriginMutation,
  experienceJson,
  getRouteSourceId,
  safeErrorResponse,
} from "../../../lib/experience/apiRoutes";
import { deleteExperienceSource, getExperienceSourceDetail } from "../../../lib/experience/apiService";

export async function GET(_req: Request, context: { params: Promise<{ id?: string }> }) {
  try {
    const sourceId = await getRouteSourceId(context);
    return experienceJson(await getExperienceSourceDetail(sourceId));
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ id?: string }> }) {
  try {
    assertSameOriginMutation(req);
    const sourceId = await getRouteSourceId(context);
    return experienceJson(await deleteExperienceSource(sourceId));
  } catch (error) {
    return safeErrorResponse(error);
  }
}

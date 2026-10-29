import {
  experienceJson,
  getRouteSourceId,
  safeErrorResponse,
} from "../../../lib/experience/apiRoutes";
import { getExperienceSourceDetail } from "../../../lib/experience/apiService";

export async function GET(_req: Request, context: { params: { id?: string } | Promise<{ id?: string }> }) {
  try {
    const sourceId = await getRouteSourceId(context);
    return experienceJson(await getExperienceSourceDetail(sourceId));
  } catch (error) {
    return safeErrorResponse(error);
  }
}

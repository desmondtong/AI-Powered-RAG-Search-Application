import {
  experienceJson,
  getRouteSourceAndRevisionIds,
  safeErrorResponse,
} from "../../../../../../lib/experience/apiRoutes";
import { getExperienceRevisionExport } from "../../../../../../lib/experience/apiService";

export async function GET(
  _req: Request,
  context: { params: { id?: string; revisionId?: string } | Promise<{ id?: string; revisionId?: string }> },
) {
  try {
    const { sourceId, revisionId } = await getRouteSourceAndRevisionIds(context);
    return experienceJson(await getExperienceRevisionExport(sourceId, revisionId));
  } catch (error) {
    return safeErrorResponse(error);
  }
}

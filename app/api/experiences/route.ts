import {
  assertSameOriginMutation,
  experienceJson,
  safeErrorResponse,
} from "../../lib/experience/apiRoutes";
import { listExperienceSources, uploadExperienceSourceFromFile } from "../../lib/experience/apiService";

export async function GET() {
  try {
    return experienceJson(await listExperienceSources());
  } catch (error) {
    return safeErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    assertSameOriginMutation(req);
    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return experienceJson(
        {
          error: {
            code: "file-required",
            message: "Experience source file is required.",
          },
        },
        { status: 400 },
      );
    }

    return experienceJson(await uploadExperienceSourceFromFile(file), { status: 201 });
  } catch (error) {
    return safeErrorResponse(error);
  }
}

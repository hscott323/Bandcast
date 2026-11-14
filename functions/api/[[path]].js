import { handleApiRequest } from "../../lib/api.js";

export async function onRequest({ request, env }) {
  return handleApiRequest(request, env);
}

/**
 * Optional Bearer token authentication.
 */

export function checkAuth(
  req: Request,
  token: string | undefined,
): Response | null {
  if (token === undefined) return null;

  const header = req.headers.get("Authorization");
  if (header === null || header !== `Bearer ${token}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return null;
}

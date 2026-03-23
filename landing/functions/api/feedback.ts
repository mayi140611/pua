interface Env {
  DB: D1Database
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  // POST: save feedback
  // Workaround: openpua.ai custom domain rewrites POST→GET but preserves body+headers
  const hasJsonBody = request.headers.get("content-type")?.includes("application/json")
  if (request.method === "POST" || hasJsonBody) {
    try {
      const body = (await request.json()) as {
        rating?: string
        task_summary?: string
        pua_level?: string
        pua_count?: number
        flavor?: string
        session_data?: string
        failure_count?: number
      }

      if (!body.rating) {
        return Response.json({ error: "rating is required" }, { status: 400, headers: corsHeaders })
      }

      await env.DB.prepare(
        `INSERT INTO feedback (rating, task_summary, pua_level, pua_count, flavor, session_data, failure_count, ip_country)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          body.rating,
          body.task_summary || null,
          body.pua_level || "L0",
          body.pua_count || 0,
          body.flavor || "阿里",
          body.session_data || null,
          body.failure_count || 0,
          request.headers.get("CF-IPCountry") || "unknown"
        )
        .run()

      return Response.json({ ok: true }, { headers: corsHeaders })
    } catch (e) {
      return Response.json(
        { error: "Failed to save feedback", detail: String(e) },
        { status: 500, headers: corsHeaders }
      )
    }
  }

  // GET: aggregate stats
  const stats = await env.DB.prepare(
    `SELECT rating, COUNT(*) as count, AVG(pua_count) as avg_pua_count
     FROM feedback GROUP BY rating ORDER BY count DESC`
  ).all()

  const total = await env.DB.prepare(
    "SELECT COUNT(*) as total FROM feedback"
  ).first<{ total: number }>()

  return Response.json({
    total_feedback: total?.total || 0,
    by_rating: stats.results,
    debug_method: request.method,
  }, { headers: corsHeaders })
}

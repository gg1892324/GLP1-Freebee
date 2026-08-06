// Netlify Function: subscribe
// Path when deployed: /.netlify/functions/subscribe
//
// Receives { firstName / first_name / name, email } from the opt-in form,
// creates or updates the subscriber in Flodesk (upsert), then adds them
// to the segment. Adding to a segment requires the subscriber's internal
// Flodesk id, NOT their email — so this is a two-step call.
//
// Requires ONE environment variable set on the Netlify site:
//   FLODESK_API_KEY -> your Flodesk API key (secret)
//
// The segment id is set below. You can override it without editing this
// file by setting an optional FLODESK_SEGMENT_ID env var on the site.

const FLODESK_API = "https://api.flodesk.com/v1";

// Segment these opt-ins join: "5 reasons women gain weight back after a GLP-1"
const DEFAULT_SEGMENT_ID = "6a718012ac99c632c59c2331";

exports.handler = async (event) => {
  // Only accept POST requests
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const apiKey = process.env.FLODESK_API_KEY;
  const segmentId = process.env.FLODESK_SEGMENT_ID || DEFAULT_SEGMENT_ID;

  if (!apiKey) {
    console.error("Missing FLODESK_API_KEY env var");
    return json(500, { error: "Server not configured" });
  }

  // Parse the incoming form data (tolerant of a few field-name variants)
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    body = Object.fromEntries(new URLSearchParams(event.body || ""));
  }

  const email = String(body.email || "").trim();
  const firstName = String(
    body.firstName || body.first_name || body.name || body.fname || ""
  ).trim();

  if (!email) {
    return json(400, { error: "Email is required" });
  }

  const headers = {
    Authorization: "Basic " + Buffer.from(apiKey + ":").toString("base64"),
    "Content-Type": "application/json",
    "User-Agent": "georgiebeames.com (info@georgiebeames.com)",
  };

  try {
    // 1) Create or update the subscriber. Returns their internal id.
    const subRes = await fetch(`${FLODESK_API}/subscribers`, {
      method: "POST",
      headers,
      body: JSON.stringify({ email, first_name: firstName }),
    });

    const subData = await subRes.json().catch(() => ({}));

    if (!subRes.ok) {
      console.error("Flodesk upsert failed:", subRes.status, subData);
      return json(502, { error: "Could not create subscriber", detail: subData });
    }

    const subscriberId = subData.id;
    if (!subscriberId) {
      console.error("No subscriber id returned:", subData);
      return json(502, { error: "No subscriber id returned" });
    }

    // 2) Add the subscriber to the segment using their internal id.
    const segRes = await fetch(
      `${FLODESK_API}/subscribers/${subscriberId}/segments`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ segment_ids: [segmentId] }),
      }
    );

    if (!segRes.ok) {
      const segData = await segRes.json().catch(() => ({}));
      console.error("Flodesk segment add failed:", segRes.status, segData);
      return json(502, { error: "Could not add to segment", detail: segData });
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error("Unexpected error:", err);
    return json(500, { error: "Unexpected server error" });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}

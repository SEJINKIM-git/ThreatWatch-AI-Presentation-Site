function normalizeRecipient(payload) {
  return String(payload?.notification_email || payload?.recipient_email || "").trim().toLowerCase();
}

function buildAcceptedResult(payload, upstreamStatus) {
  const recipient = normalizeRecipient(payload);
  const requested = Boolean(recipient || payload?.delivery_requested);

  return {
    source: "live",
    delivery: {
      requested,
      channel: requested ? "email" : "workspace",
      recipient,
      status: requested ? "sent" : "not_requested",
      message: requested
        ? `Webhook accepted by n8n${upstreamStatus ? ` (HTTP ${upstreamStatus})` : ""}. If the n8n mail node is active, it will send to ${recipient}.`
        : `Webhook accepted by n8n${upstreamStatus ? ` (HTTP ${upstreamStatus})` : ""}.`,
    },
    final_payload: payload || {},
    ai_result: {
      summary_bullets: [payload?.summary || "Connected workflow accepted the alert payload."],
      risk_level: payload?.risk_level || "P2",
      risk_score: payload?.risk_score ?? 50,
      rationale: ["n8n returned a successful response without a JSON result body."],
      recommended_actions: ["Confirm the downstream n8n mail node execution log for final delivery status."],
      missing_data_list: [],
      confidence: payload?.confidence ?? 0.5,
    },
  };
}

async function readUpstreamResponse(response, payload) {
  const text = await response.text();
  if (!text.trim()) {
    return buildAcceptedResult(payload, response.status);
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      ...buildAcceptedResult(payload, response.status),
      delivery: {
        ...buildAcceptedResult(payload, response.status).delivery,
        message: `Webhook accepted by n8n, but returned a non-JSON response: ${text.slice(0, 180)}`,
      },
      upstream_text: text,
    };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { webhookUrl, payload } = req.body || {};

  if (!webhookUrl || typeof webhookUrl !== "string") {
    return res.status(400).json({ error: "Missing webhookUrl" });
  }

  let target;
  try {
    target = new URL(webhookUrl);
  } catch {
    return res.status(400).json({ error: "Invalid webhookUrl" });
  }

  if (!["https:", "http:"].includes(target.protocol)) {
    return res.status(400).json({ error: "Webhook URL must use http or https" });
  }

  try {
    const response = await fetch(target.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload || {}),
    });

    const data = await readUpstreamResponse(response, payload || {});

    if (!response.ok) {
      return res.status(response.status).json({
        error: `n8n webhook failed with HTTP ${response.status}`,
        upstream: data,
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(502).json({
      error: "Failed to reach n8n webhook",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

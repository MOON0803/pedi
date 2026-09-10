import { getStore } from "@netlify/blobs";

const KEY = "ledger";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function emptyLedger() {
  return { sales: [], config: null, savedAt: 0 };
}

/* 들어온 변경분을 현재 장부에 합칩니다.
   같은 판매건은 updatedAt이 더 최신인 쪽이 이깁니다. */
function merge(current, incoming) {
  const map = new Map();
  (current.sales || []).forEach((s) => map.set(s.id, s));
  (incoming.sales || []).forEach((s) => {
    if (!s || !s.id) return;
    const prev = map.get(s.id);
    if (!prev || (s.updatedAt || 0) >= (prev.updatedAt || 0)) map.set(s.id, s);
  });

  let config = current.config;
  if (
    incoming.config &&
    (!config || (incoming.config.updatedAt || 0) >= (config.updatedAt || 0))
  ) {
    config = incoming.config;
  }

  return {
    sales: [...map.values()].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    config,
    savedAt: Date.now(),
  };
}

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 204 });

  const pin = process.env.BOOTH_PIN || "";
  if (pin && req.headers.get("x-booth-pin") !== pin) {
    return new Response(JSON.stringify({ error: "pin" }), {
      status: 401,
      headers: HEADERS,
    });
  }

  const store = getStore({ name: "pedident", consistency: "strong" });

  try {
    if (req.method === "GET") {
      const data = (await store.get(KEY, { type: "json" })) || emptyLedger();
      return new Response(JSON.stringify(data), { headers: HEADERS });
    }

    if (req.method === "POST") {
      const incoming = await req.json();
      const current = (await store.get(KEY, { type: "json" })) || emptyLedger();
      const next = merge(current, incoming);
      await store.setJSON(KEY, next);

      /* 같은 순간에 다른 기기가 덮어썼는지 확인하고, 그랬다면 한 번 더 합칩니다. */
      const check = (await store.get(KEY, { type: "json" })) || emptyLedger();
      const sent = (incoming.sales || []).map((s) => s.id);
      const have = new Set((check.sales || []).map((s) => s.id));
      const missing = sent.filter((id) => !have.has(id));
      if (missing.length) {
        const fixed = merge(check, incoming);
        await store.setJSON(KEY, fixed);
        return new Response(JSON.stringify(fixed), { headers: HEADERS });
      }

      return new Response(JSON.stringify(check), { headers: HEADERS });
    }

    return new Response(JSON.stringify({ error: "method" }), {
      status: 405,
      headers: HEADERS,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err && err.message) }), {
      status: 500,
      headers: HEADERS,
    });
  }
};

export const config = { path: "/api/ledger" };

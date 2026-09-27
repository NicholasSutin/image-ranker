import manifest from "./manifest.json";

// Renamed from "session" when logins became per-person, so older anonymous cookies no longer work.
const COOKIE = "user";
const SESSION_DAYS = 30;
// Reachable without a session (the login page itself).
const PUBLIC_PATHS = new Set(["/login", "/login.html", "/style.css", "/login.js"]);

const REQUIRED_CONFIG = ["ACCESS_CODE", "SESSION_SECRET", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"];

export default {
  async fetch(request, env, ctx) {
    const missing = REQUIRED_CONFIG.filter((k) => !env[k] || env[k].startsWith("REPLACE_WITH"));
    if (missing.length) {
      return new Response(`Missing config: ${missing.join(", ")}. See .dev.vars.example.`, { status: 500 });
    }

    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/login") return loginPage(request, env);
    if (pathname === "/api/login" && request.method === "POST") return login(request, env);
    if (pathname === "/api/logout" && request.method === "POST") return logout();
    if (PUBLIC_PATHS.has(pathname)) return env.ASSETS.fetch(request);

    // Images skip the database check: they're requested in bulk and a signed cookie is enough to view them.
    const user = await readSession(request, env, { checkUser: !pathname.startsWith("/sized/") });
    const invite = url.searchParams.get("invite");
    if (!user) {
      if (pathname.startsWith("/api/")) return json({ error: "unauthorized" }, 401);
      return Response.redirect(loginUrl(url, invite), 302);
    }
    // Someone else's invite link opened in this browser: let them say who they are.
    if (invite && (pathname === "/" || pathname === "/results") && !(await isInvitee(env, user, invite))) {
      return Response.redirect(loginUrl(url, invite), 302);
    }

    if (pathname === "/api/manifest") return json(manifest);
    if (pathname === "/api/me") return me(request, env, user);
    if (pathname === "/api/ping" && request.method === "POST") return ping(env, user);
    if (pathname === "/api/vote" && request.method === "POST") return vote(request, env, user.id);
    if (pathname === "/api/results") return results(url, env, user);
    if (pathname === "/api/people") return people(url, env);
    if (pathname === "/api/delete-user" && request.method === "POST") return deleteUser(request, env, user);
    if (pathname === "/api/tiers") return myTiers(url, env, user.id);
    if (pathname === "/api/tier" && request.method === "POST") return setTier(request, env, user.id);
    if (pathname === "/api/star" && request.method === "POST") return setStar(request, env, user.id);
    if (pathname === "/api/finish" && request.method === "POST") return finish(request, env, user.id);

    const res = await env.ASSETS.fetch(request);
    // Gated content must never land in a shared cache.
    const out = new Response(res.body, res);
    // Images can sit in the browser cache; page code must revalidate so updates show up immediately.
    out.headers.set("Cache-Control", pathname.startsWith("/sized/") ? "private, max-age=3600" : "private, no-cache");
    return out;
  },
};

// ---------- auth ----------

function loginUrl(url, invite) {
  const login = new URL("/login", url);
  if (invite) login.searchParams.set("invite", invite);
  return login;
}

// Names match case-insensitively and ignore extra spaces.
const nameKey = (name) => name.trim().replace(/\s+/g, " ").toLowerCase();

async function isInvitee(env, user, invite) {
  const row = await env.DB.prepare("SELECT name_key FROM users WHERE id = ?").bind(user.id).first();
  return row?.name_key === nameKey(invite);
}

async function loginPage(request, env) {
  // Already signed in: skip the form, unless this is someone else's invite link.
  const url = new URL(request.url);
  const invite = url.searchParams.get("invite");
  const user = await readSession(request, env);
  if (user && (!invite || (await isInvitee(env, user, invite)))) return Response.redirect(new URL("/", url), 302);
  const res = await env.ASSETS.fetch(new URL("/login", request.url));
  return new HTMLRewriter()
    .on("#turnstile", { element: (el) => el.setAttribute("data-sitekey", env.TURNSTILE_SITE_KEY) })
    .transform(res);
}

async function login(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await env.LOGIN_LIMITER.limit({ key: ip });
  if (!success) return json({ error: "Too many attempts. Wait a minute." }, 429);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const name = String(body.name ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 40) return json({ error: "Enter your name (up to 40 characters)." }, 400);
  const invite = typeof body.invite === "string" && body.invite.trim() ? body.invite.trim().slice(0, 40) : null;

  if (!(await verifyTurnstile(body.token, ip, env))) {
    return json({ error: "Verification failed. Try again.", resetTurnstile: true }, 403);
  }

  const code = String(body.code ?? "").replace(/\D/g, "");
  if (!(await safeEqual(code, env.ACCESS_CODE.replace(/\D/g, "")))) {
    return json({ error: "Wrong code.", resetTurnstile: true }, 403);
  }

  // The same name always maps to the same person, so progress follows them across devices.
  await env.DB.prepare("INSERT INTO users (id, name, name_key, invite) VALUES (?, ?, ?, ?) ON CONFLICT (name_key) DO NOTHING")
    .bind(crypto.randomUUID(), name, nameKey(name), invite)
    .run();
  const { id } = await env.DB.prepare("SELECT id FROM users WHERE name_key = ?").bind(nameKey(name)).first();
  const cf = request.cf ?? {};
  await env.DB.prepare(
    `INSERT INTO logins (user_id, invite, city, region, country, latitude, longitude, timezone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, invite, cf.city ?? null, cf.region ?? null, cf.country ?? null,
      cf.latitude ? Number(cf.latitude) : null, cf.longitude ? Number(cf.longitude) : null, cf.timezone ?? null)
    .run();

  const cookie = await createSession(env, id);
  return json({ ok: true, next: await landingPage(env, id) }, 200, { "Set-Cookie": cookie });
}

// Someone who has already ranked a whole set goes straight to their results.
async function landingPage(env, id) {
  const { results: rows } = await env.DB.prepare("SELECT set_name, image FROM tiers WHERE session = ?").bind(id).all();
  for (const [set, images] of Object.entries(manifest)) {
    const placed = new Set(rows.filter((r) => r.set_name === set).map((r) => r.image));
    if (images.length && images.every((src) => placed.has(src))) return `/results?set=${encodeURIComponent(set)}`;
  }
  return "/";
}

function logout() {
  return json({ ok: true }, 200, {
    "Set-Cookie": `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
  });
}

async function verifyTurnstile(token, ip, env) {
  if (typeof token !== "string" || !token) return false;
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: ip }),
  });
  const data = await res.json();
  return data.success === true;
}

// Cookie format: <userId>.<expiresAtSeconds>.<hmac>
async function createSession(env, id) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload = `${id}.${exp}`;
  const sig = await hmac(env.SESSION_SECRET, payload);
  return `${COOKIE}=${payload}.${sig}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
}

// Returns { id } for a valid cookie, else null.
// checkUser also requires the user to still exist, so a cookie signed for a database that has
// since been recreated can't keep saving rankings under an id nobody can sign in as.
async function readSession(request, env, { checkUser = true } = {}) {
  const match = (request.headers.get("Cookie") ?? "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return null;
  const [id, exp, sig] = match[1].split(".");
  if (!id || !exp || !sig || Number(exp) < Date.now() / 1000) return null;
  const expected = await hmac(env.SESSION_SECRET, `${id}.${exp}`);
  if (!(await safeEqual(sig, expected))) return null;
  if (checkUser && !(await env.DB.prepare("SELECT 1 FROM users WHERE id = ?").bind(id).first())) return null;
  return { id };
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" })[c]);
}

async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

// ---------- people ----------

async function me(request, env, user) {
  const row = await env.DB.prepare("SELECT name FROM users WHERE id = ?").bind(user.id).first();
  return json({ id: user.id, name: row?.name ?? null, canDelete: await canDelete(request, env, user) });
}

// Only ADMIN_NAME, and only from ADMIN_REGION ("<country>-<region>", matched against Cloudflare's
// IP geolocation), can delete people. Leaving either unset turns deleting off.
async function canDelete(request, env, user) {
  if (!env.ADMIN_NAME || !env.ADMIN_REGION) return false;
  const cf = request.cf ?? {};
  if (`${cf.country}-${cf.regionCode}`.toUpperCase() !== env.ADMIN_REGION.toUpperCase()) return false;
  return isInvitee(env, user, env.ADMIN_NAME);
}

// Removes a person and everything they did: votes, tiers, stars and logins.
async function deleteUser(request, env, user) {
  if (!(await canDelete(request, env, user))) return json({ error: "Not allowed" }, 403);
  const { id } = await request.json().catch(() => ({}));
  if (typeof id !== "string" || !id) return json({ error: "Missing user" }, 400);
  if (id === user.id) return json({ error: "You can't delete yourself" }, 400);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM votes WHERE session = ?").bind(id),
    env.DB.prepare("DELETE FROM tiers WHERE session = ?").bind(id),
    env.DB.prepare("DELETE FROM stars WHERE session = ?").bind(id),
    env.DB.prepare("DELETE FROM logins WHERE user_id = ?").bind(id),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id),
  ]);
  return json({ ok: true });
}

// Sent every ~20s while a page is in view. Only short gaps count, so time away isn't added.
const MAX_PING_GAP = 60;

async function ping(env, user) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `UPDATE users SET
       active_seconds = active_seconds + CASE WHEN ?1 - last_seen_at BETWEEN 0 AND ?2 THEN ?1 - last_seen_at ELSE 0 END,
       last_seen_at = ?1
     WHERE id = ?3`,
  )
    .bind(now, MAX_PING_GAP, user.id)
    .run();
  return json({ ok: true });
}

// Everyone's progress in a set, for the person switcher on the results page.
async function people(url, env) {
  const set = url.searchParams.get("set");
  const images = manifest[set];
  if (!images) return json({ error: "Unknown set" }, 404);

  const [{ results: users }, { results: logins }, { results: tiers }, { results: stars }, { results: votes }] =
    await env.DB.batch([
      env.DB.prepare("SELECT * FROM users ORDER BY created_at"),
      env.DB.prepare("SELECT * FROM logins ORDER BY id DESC"),
      env.DB.prepare("SELECT session, image FROM tiers WHERE set_name = ?").bind(set),
      env.DB.prepare("SELECT session, image FROM stars WHERE set_name = ?").bind(set),
      env.DB.prepare("SELECT session, COUNT(*) AS n FROM votes WHERE set_name = ? GROUP BY session").bind(set),
    ]);

  const inSet = new Set(images);
  const count = (rows, id) => rows.filter((r) => r.session === id && inSet.has(r.image)).length;
  return json({
    total: images.length,
    people: users.map((u) => ({
      id: u.id,
      name: u.name,
      invite: u.invite,
      startedAt: u.created_at,
      finishedAt: u.finished_at,
      lastSeenAt: u.last_seen_at,
      activeSeconds: u.active_seconds,
      tiered: count(tiers, u.id),
      starred: count(stars, u.id),
      votes: votes.find((v) => v.session === u.id)?.n ?? 0,
      logins: logins
        .filter((l) => l.user_id === u.id)
        .map((l) => ({
          at: l.created_at,
          city: l.city,
          region: l.region,
          country: l.country,
          latitude: l.latitude,
          longitude: l.longitude,
          timezone: l.timezone,
        })),
    })),
  });
}

// ---------- voting ----------

async function vote(request, env, session) {
  const { success } = await env.VOTE_LIMITER.limit({ key: session });
  if (!success) return json({ error: "Slow down." }, 429);

  const { set, winner, loser } = await request.json().catch(() => ({}));
  const images = manifest[set];
  if (!images || winner === loser || !images.includes(winner) || !images.includes(loser)) {
    return json({ error: "Invalid vote" }, 400);
  }

  await env.DB.prepare("INSERT INTO votes (set_name, winner, loser, session) VALUES (?, ?, ?, ?)")
    .bind(set, winner, loser, session)
    .run();
  return json({ ok: true });
}

// ---------- tiers ----------

const TIERS = ["S", "A", "B", "X"]; // X = don't put on site

async function myTiers(url, env, session) {
  const set = url.searchParams.get("set");
  if (!manifest[set]) return json({ error: "Unknown set" }, 404);
  const { results: rows } = await env.DB.prepare(
    "SELECT image, tier FROM tiers WHERE set_name = ? AND session = ?",
  )
    .bind(set, session)
    .all();
  return json(Object.fromEntries(rows.map((r) => [r.image, r.tier])));
}

// tier: null clears the image's tier (used by undo).
async function setTier(request, env, session) {
  const { success } = await env.VOTE_LIMITER.limit({ key: session });
  if (!success) return json({ error: "Slow down." }, 429);

  const { set, image, tier } = await request.json().catch(() => ({}));
  if (!manifest[set]?.includes(image) || (tier !== null && !TIERS.includes(tier))) {
    return json({ error: "Invalid tier" }, 400);
  }

  const stmt =
    tier === null
      ? env.DB.prepare("DELETE FROM tiers WHERE set_name = ? AND session = ? AND image = ?").bind(set, session, image)
      : env.DB.prepare(
          `INSERT INTO tiers (set_name, session, image, tier) VALUES (?, ?, ?, ?)
           ON CONFLICT (set_name, session, image) DO UPDATE SET tier = excluded.tier, updated_at = unixepoch()`,
        ).bind(set, session, image, tier);
  await stmt.run();
  return json({ ok: true });
}

// ---------- stars ----------

async function setStar(request, env, session) {
  const { success } = await env.VOTE_LIMITER.limit({ key: session });
  if (!success) return json({ error: "Slow down." }, 429);

  const { set, image, starred } = await request.json().catch(() => ({}));
  if (!manifest[set]?.includes(image) || typeof starred !== "boolean") {
    return json({ error: "Invalid star" }, 400);
  }

  const stmt = starred
    ? env.DB.prepare("INSERT OR IGNORE INTO stars (set_name, session, image) VALUES (?, ?, ?)")
    : env.DB.prepare("DELETE FROM stars WHERE set_name = ? AND session = ? AND image = ?");
  await stmt.bind(set, session, image).run();
  return json({ ok: true });
}

// Favorites confirmed: the end of the flow. Only the first time counts.
async function finish(request, env, session) {
  const { set } = await request.json().catch(() => ({}));
  if (!manifest[set]) return json({ error: "Unknown set" }, 404);
  const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM stars WHERE set_name = ? AND session = ?")
    .bind(set, session)
    .first();
  if (n < 3) return json({ error: "Pick at least 3 favorites" }, 400);
  await env.DB.prepare("UPDATE users SET finished_at = COALESCE(finished_at, unixepoch()) WHERE id = ?").bind(session).run();
  return json({ ok: true });
}

// ---------- results ----------

// One person's own choices: yours by default, or anyone's via ?user=.
async function results(url, env, user) {
  const set = url.searchParams.get("set");
  const images = manifest[set];
  if (!images) return json({ error: "Unknown set" }, 404);
  const session = url.searchParams.get("user") || user.id;

  const [{ results: votes }, { results: tiers }, { results: stars }] = await env.DB.batch([
    env.DB.prepare("SELECT winner, loser FROM votes WHERE set_name = ? AND session = ? ORDER BY id").bind(set, session),
    env.DB.prepare("SELECT image, tier FROM tiers WHERE set_name = ? AND session = ?").bind(set, session),
    env.DB.prepare("SELECT image FROM stars WHERE set_name = ? AND session = ?").bind(set, session),
  ]);

  // Elo over this person's votes, plus raw win/loss counts.
  const stats = Object.fromEntries(
    images.map((src) => [src, { src, elo: 1500, wins: 0, losses: 0, tier: null, starred: false }]),
  );
  for (const { image, tier } of tiers) {
    if (stats[image]) stats[image].tier = tier;
  }
  for (const { image } of stars) {
    if (stats[image]) stats[image].starred = true;
  }
  for (const { winner, loser } of votes) {
    const w = stats[winner];
    const l = stats[loser];
    if (!w || !l) continue; // image was removed from the set since
    const expected = 1 / (1 + 10 ** ((l.elo - w.elo) / 400));
    const delta = 32 * (1 - expected);
    w.elo += delta;
    l.elo -= delta;
    w.wins++;
    l.losses++;
  }

  const ranked = Object.values(stats)
    .map((s) => ({ ...s, elo: Math.round(s.elo) }))
    .sort((a, b) => b.elo - a.elo);
  return json({ set, totalVotes: votes.length, ranked });
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}

// Writes go out one at a time, in order, and are retried until the server accepts them,
// so a rate limit or a network blip can't silently drop a ranking (or apply an undo before
// the placement it undoes).
let queue = Promise.resolve();
let pending = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function save(url, body) {
  pending++;
  queue = queue.then(() => send(url, body)).finally(() => pending--);
  return queue;
}

// Resolves once everything queued so far has been saved.
export const saved = () => queue;

async function send(url, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true,
      });
      if (res.status === 401) return location.replace("/login");
      // 400 means the request itself is invalid: retrying won't help.
      if (res.ok || res.status === 400) return;
    } catch {}
    await sleep(Math.min(500 * 2 ** attempt, 8000));
  }
}

// Closing the tab with rankings still unsaved: have the browser ask first.
window.addEventListener("beforeunload", (e) => {
  if (pending) e.preventDefault();
});

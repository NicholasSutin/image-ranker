// Time-spent tracking: ping while the page is in view. The Worker adds up the gaps between
// pings and ignores long ones, so time with the tab hidden or closed isn't counted.
(() => {
  const ping = () => fetch("/api/ping", { method: "POST", keepalive: true }).catch(() => {});
  ping();
  setInterval(() => { if (document.visibilityState === "visible") ping(); }, 20000);
  // Also ping on hide (to count the last few seconds) and on return (to start a new stretch).
  document.addEventListener("visibilitychange", ping);
})();

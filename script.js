(() => {
  const DOMAIN = "buk1t.com";

  // Prefer a local file if you add it later. Optional.
  const LOCAL_CONFIG = "/status.json";

  // Registry (source of truth)
  const SITEMAP = "https://api.buk1t.com/json/buk1t.json";

  const WARN_MS = 900;
  const TIMEOUT_MS = 5000;

  const ISSUE_EMAIL = "dev@buk1t.com";

  // fallback only — status must survive if api is down
  const FALLBACK_REPOS = {
    www: "https://github.com/buk1t/www",
    labs: "https://github.com/buk1t/labs",
    search: "https://github.com/buk1t/search",
    status: "https://github.com/buk1t/status",
    about: "https://github.com/buk1t/about-me",
    api: "https://github.com/buk1t/api",
    wildcard: "https://github.com/buk1t/catch-all"
  };

  // ---------- DOM ----------
  const checksEl = document.getElementById("checks");
  const subtitleEl = document.getElementById("subtitle");
  const metaEl = document.getElementById("meta");
  const reportBtn = document.getElementById("reportBtn");

  // ---------- utils ----------
  function uniqBy(arr, keyFn) {
    const seen = new Set();
    const out = [];
    for (const x of arr) {
      const k = keyFn(x);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(x);
    }
    return out;
  }

  function pill(status, text) {
    const p = document.createElement("span");
    p.className = "pill";

    const d = document.createElement("span");
    d.className = "dot";
    d.style.background =
      status === "up" ? "var(--good)" :
      status === "slow" ? "var(--warn)" :
      status === "down" ? "var(--bad)" :
      "var(--warn)";

    const t = document.createElement("span");
    t.textContent = text;

    p.appendChild(d);
    p.appendChild(t);
    return p;
  }

  function linkPill(status, text, href) {
    const p = document.createElement("span");
    p.className = "pill";

    const d = document.createElement("span");
    d.className = "dot";
    d.style.background =
      status === "up" ? "var(--good)" :
      status === "slow" ? "var(--warn)" :
      status === "down" ? "var(--bad)" :
      "var(--warn)";

    const a = document.createElement("a");
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = text;

    p.appendChild(d);
    p.appendChild(a);
    return p;
  }

  function buildUrlLine(url, subtitle) {
    const el = document.createElement("div");
    el.className = "url";

    if (subtitle) {
      el.textContent = subtitle;
      return el;
    }

    try {
      const u = new URL(url);
      const host = u.host;
      const path = (u.pathname || "/") + (u.search || "") + (u.hash || "");
      const parts = host.split(".");
      const first = parts[0] || host;
      const rest = parts.slice(1).join(".");

      const strong = document.createElement("span");
      strong.className = "subdomain";
      strong.textContent = first;

      const tail = document.createElement("span");
      tail.textContent = (rest ? "." + rest : "") + (path === "/" ? "" : path);

      el.appendChild(strong);
      el.appendChild(tail);
      return el;
    } catch {
      el.textContent = String(url).replace(/^https?:\/\//, "");
      return el;
    }
  }

  function makeCard(target) {
    const box = document.createElement("div");
    box.className = "item";

    const title = document.createElement("div");
    title.className = "name";
    title.textContent = target.name;

    const st = document.createElement("div");
    st.className = "status";
    st.appendChild(pill("checking", "checking…"));

    box.appendChild(title);

    if (!target.hideUrl) {
      box.appendChild(buildUrlLine(target.url));
    } else {
      box.appendChild(buildUrlLine("", target.subtitle || ""));
    }

    box.appendChild(st);
    checksEl.appendChild(box);

    return { box, st };
  }

  // ---------- reachability + latency ----------
  async function ping(url) {
    const controller = new AbortController();
    const start = performance.now();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const u = new URL(url);
      u.searchParams.set("_status", String(Date.now()));

      await fetch(u.toString(), {
        mode: "no-cors",
        cache: "no-store",
        signal: controller.signal
      });

      clearTimeout(timer);
      return { ok: true, ms: Math.round(performance.now() - start) };
    } catch {
      clearTimeout(timer);
      return { ok: false, ms: Math.round(performance.now() - start) };
    }
  }

  function makeWildcardTarget() {
    const stamp = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    const sub = `__status-${stamp}-${rand}`;
    return {
      name: "catch-all routing",
      url: `https://${sub}.${DOMAIN}/`,
      hideUrl: true,
      subtitle: `${sub}.${DOMAIN}`,
      repoKey: "wildcard"
    };
  }

  async function tryJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("bad response");
    return await res.json();
  }

  async function loadTargets() {
    // hard truth: status page should NOT depend on api,
    // so defaults always exist.
    let targets = [
      { name: "www", url: `https://www.${DOMAIN}/` },
      { name: "labs", url: `https://labs.${DOMAIN}/` },
      { name: "search", url: `https://search.${DOMAIN}/` },
      { name: "status", url: `https://status.${DOMAIN}/` },
      { name: "about", url: `https://about.${DOMAIN}/` },
      { name: "api", url: `https://api.${DOMAIN}/` }
    ];

    // Optional local config
    try {
      const local = await tryJson(LOCAL_CONFIG);
      if (Array.isArray(local.targets)) targets = local.targets;
      if (Array.isArray(local.checks)) targets = local.checks; // allow either key
    } catch {}

    // Optional sitemap enrichment (nice-to-have)
    try {
      const map = await tryJson(SITEMAP);

      // Back-compat: map.items like your old sitemap format
      const items = Array.isArray(map.items) ? map.items : [];
      const subs = [
        ...new Set(
          items.map((it) => String(it.subdomain || "www").toLowerCase().trim())
        )
      ];

      // Filter ONLY to your canonical set
      const allowed = new Set(["www", "labs", "search", "status", "about", "api"]);
      const fromMap = subs
        .filter((s) => allowed.has(s))
        .map((s) => ({ name: s, url: `https://${s}.${DOMAIN}/` }));

      targets = uniqBy([...targets, ...fromMap], (t) => t.url);
    } catch {}

    // Always include wildcard test
    targets.push(makeWildcardTarget());
    return uniqBy(targets, (t) => t.url);
  }

  // ---------- repo pills ----------
  function parseRepoSlug(input) {
    const s = String(input || "").trim();
    const https = s.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/i);
    if (https) return `${https[1]}/${https[2]}`;
    const slug = s.match(/^([^/]+)\/([^/]+?)$/);
    if (slug) return `${slug[1]}/${slug[2]}`;
    return null;
  }

  function relTime(iso) {
    const d = new Date(iso);
    const seconds = Math.round((d.getTime() - Date.now()) / 1000);
    const abs = Math.abs(seconds);
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

    if (abs < 60) return rtf.format(Math.round(seconds), "second");
    if (abs < 3600) return rtf.format(Math.round(seconds / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(seconds / 3600), "hour");
    return rtf.format(Math.round(seconds / 86400), "day");
  }

  async function fetchRepoInfo(repoUrlOrSlug) {
    const slug = parseRepoSlug(repoUrlOrSlug);
    if (!slug) return { slug: null, pushed_at: null, html_url: null };

    const res = await fetch(`https://api.github.com/repos/${slug}`, {
      headers: { "Accept": "application/vnd.github+json" },
      cache: "no-store"
    });

    if (!res.ok) {
      return { slug, pushed_at: null, html_url: `https://github.com/${slug}` };
    }
    const data = await res.json();
    return {
      slug,
      pushed_at: data.pushed_at || null,
      html_url: data.html_url || `https://github.com/${slug}`
    };
  }

  function repoPill(htmlUrl, pushed_at) {
    const label = pushed_at ? `repo • ${relTime(pushed_at)}` : `repo • unavailable`;
    const p = pill(pushed_at ? "up" : "warn", label);

    if (htmlUrl) {
      p.innerHTML = "";
      const d = document.createElement("span");
      d.className = "dot";
      d.style.background = pushed_at ? "var(--good)" : "var(--warn)";

      const a = document.createElement("a");
      a.href = htmlUrl;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = label;

      p.appendChild(d);
      p.appendChild(a);
    }
    return p;
  }

  function normalizeRepos(map) {
    const out = {};
    for (const [k, v] of Object.entries(map || {})) {
      const key = String(k || "").toLowerCase().trim();
      const val = String(v || "").trim();
      if (key && val) out[key] = val;
    }
    return out;
  }

  async function loadRepoMap() {
    let repos = { ...FALLBACK_REPOS };

    // local override (optional)
    try {
      const local = await tryJson(LOCAL_CONFIG);
      if (local && typeof local.repos === "object") {
        repos = { ...repos, ...normalizeRepos(local.repos) };
      }
    } catch {}

    // remote registry (nice-to-have)
    try {
      const map = await tryJson(SITEMAP);

      // Preferred schema
      if (map && typeof map.repos === "object") {
        repos = { ...repos, ...normalizeRepos(map.repos) };
      }

      // Back-compat
      if (map && typeof map.repo_map === "object") {
        repos = { ...repos, ...normalizeRepos(map.repo_map) };
      }
    } catch {}

    return repos;
  }

  // ---------- report ----------
  function setupReportButton(extraContext = "") {
    if (!reportBtn) return;

    reportBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const now = new Date();
      const subject = `buk1t issue report (${now.toLocaleString()})`;

      const body = [
        "Describe what happened:",
        "",
        "Which URL?",
        "",
        "What did you expect?",
        "",
        "What actually happened?",
        "",
        "—",
        `Time: ${now.toISOString()}`,
        `Status page: ${location.href}`,
        extraContext ? `Context: ${extraContext}` : ""
      ].filter(Boolean).join("\n");

      location.href =
        `mailto:${ISSUE_EMAIL}` +
        `?subject=${encodeURIComponent(subject)}` +
        `&body=${encodeURIComponent(body)}`;
    });
  }

  // ---------- main ----------
  async function main() {
    subtitleEl.textContent = navigator.onLine ? "Checking services…" : "You appear to be offline.";

    const targets = await loadTargets();

    checksEl.innerHTML = "";
    const cards = targets.map((t) => ({ t, ...makeCard(t) }));

    const results = await Promise.all(
      cards.map(async (c) => ({ c, r: await ping(c.t.url) }))
    );

    let up = 0, slow = 0, down = 0;

    for (const { c, r } of results) {
      c.st.innerHTML = "";

      const href = c.t.url;

      if (r.ok) {
        if (r.ms != null && r.ms >= WARN_MS) {
          slow++;
          c.st.appendChild(linkPill("slow", `slow • ${r.ms}ms`, href));
        } else {
          up++;
          c.st.appendChild(linkPill("up", `up • ${r.ms ?? "?"}ms`, href));
        }
      } else {
        down++;
        c.st.appendChild(linkPill("down", "down • unreachable", href));
      }
    }

    subtitleEl.textContent =
      down === 0 && slow === 0 ? `All good — ${up} up` : `${up} up • ${slow} slow • ${down} down`;

    // Repo pills (optional; don’t die if rate-limited)
    let newestPush = null;
    try {
      const repoMap = await loadRepoMap();

      const needed = uniqBy(
        cards
          .map((c) => {
            const key = (c.t.repoKey || c.t.name || "").toLowerCase();
            return { key, repo: repoMap[key] };
          })
          .filter((x) => x.repo),
        (x) => x.repo
      );

      const infos = await Promise.all(needed.map((x) => fetchRepoInfo(x.repo)));
      const infoBySlug = new Map(infos.map((i) => [i.slug, i]));

      for (const c of cards) {
        const key = (c.t.repoKey || c.t.name || "").toLowerCase();
        const repo = repoMap[key];
        if (!repo) continue;

        const slug = parseRepoSlug(repo);
        const info = slug ? infoBySlug.get(slug) : null;

        if (info?.pushed_at) {
          const ts = new Date(info.pushed_at).getTime();
          if (newestPush == null || ts > newestPush) newestPush = ts;
        }

        c.st.appendChild(
          repoPill(
            info?.html_url || (slug ? `https://github.com/${slug}` : repo),
            info?.pushed_at || null
          )
        );
      }
    } catch {}

    setupReportButton(
      newestPush ? `Most recent repo push: ${new Date(newestPush).toISOString()}` : ""
    );

    const checkedAt = new Date();
    metaEl.textContent =
      `checked: ${checkedAt.toLocaleString()}` +
      (newestPush ? ` • latest repo push: ${relTime(new Date(newestPush).toISOString())}` : "");
  }

  main();
})();
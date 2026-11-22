
(() => {
  "use strict";

  const CONFIG = {
    postLinkPattern: /^\/posts\/\d+\/?$/,
    userLinkExcludes: new Set([
      "/", "/login", "/signup", "/terms", "/privacy", "/donate",
    ]),
    pageQueryParam: "page",
    infiniteScrollMargin: "800px",
    maxAncestorHops: 8,
  };

  if (window.__yxInitialized) return;
  window.__yxInitialized = true;

  const state = {
    currentPage: 1,
    isLoading: false,
    reachedEnd: false,
    processedPostLinks: new WeakSet(),
    seenPostKeys: new Set(),
    observerPaused: false,
  };

  function isUserProfileLink(href) {
    try {
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin) return false;
      const path = url.pathname;
      if (CONFIG.userLinkExcludes.has(path)) return false;
      return /^\/[A-Za-z0-9_\-.]+$/.test(path);
    } catch {
      return false;
    }
  }

  function isPostDetailLink(href) {
    try {
      const url = new URL(href, location.origin);
      return CONFIG.postLinkPattern.test(url.pathname);
    } catch {
      return false;
    }
  }

  function findPostCardAncestor(postLink) {
    let el = postLink;
    let best = null;
    for (let i = 0; i < CONFIG.maxAncestorHops && el.parentElement; i++) {
      el = el.parentElement;
      const hasAvatar = !!el.querySelector("img");
      const hasUserLink = Array.from(el.querySelectorAll("a[href]"))
        .some((a) => isUserProfileLink(a.getAttribute("href")));
      if (!hasAvatar || !hasUserLink) continue;

      const postLinks = Array.from(el.querySelectorAll('a[href*="/posts/"]'))
        .filter((a) => isPostDetailLink(a.getAttribute("href")));

      if (postLinks.length > 2) break;
      best = el;

      if (postLinks.length === 1) break;
    }
    return best;
  }

  function postKeyFromLink(link) {
    try {
      const url = new URL(link.getAttribute("href"), location.origin);
      return url.pathname.replace(/\/$/, "");
    } catch {
      return null;
    }
  }

  function isNestedPostCard(card) {
    if (!card) return false;
    let p = card.parentElement;
    while (p) {
      if (p.classList?.contains("yx-post")) return true;
      p = p.parentElement;
    }
    return false;
  }

  function enhancePostCard(card) {
    if (!card || card.dataset.yxEnhanced === "1") return;
    card.dataset.yxEnhanced = "1";
    card.classList.add("yx-post");

    let frame = card.parentElement;
    for (let depth = 0; depth < 2 && frame && frame !== document.body; depth++, frame = frame.parentElement) {
      if (frame.matches("main, [role='main'], nav, header, .yx-real-sidebar")) break;
      const topLevelPosts = Array.from(frame.querySelectorAll(".yx-post"))
        .filter((post) => !isNestedPostCard(post));
      if (topLevelPosts.length !== 1) break;
      frame.classList.add("yx-post-frame");
    }

    const avatarImg = card.querySelector("img");
    if (avatarImg) {
      const wrapper = avatarImg.closest("a") || avatarImg.parentElement;
      if (wrapper) wrapper.classList.add("yx-avatar");
    }

    const userLinks = Array.from(card.querySelectorAll("a[href]")).filter(
      (a) => isUserProfileLink(a.getAttribute("href"))
    );
    userLinks.forEach((a) => {
      const text = a.textContent.trim();
      if (text.startsWith("@")) {
        a.classList.add("yx-handle");
      } else if (text.length > 0 && !a.querySelector("img")) {
        a.classList.add("yx-displayname");
      }
    });

    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    const timeRegex = /(\d+\s*(分前|時間前|日前|秒前)|たった今)/;
    let node;
    while ((node = walker.nextNode())) {
      if (timeRegex.test(node.textContent) && node.parentElement) {
        node.parentElement.classList.add("yx-time");
        break;
      }
    }

  }

  function scanAndEnhance(root = document) {
    const postLinks = Array.from(
      root.querySelectorAll('a[href*="/posts/"]')
    ).filter((a) => isPostDetailLink(a.getAttribute("href")));

    postLinks.forEach((link) => {
      if (state.processedPostLinks.has(link)) return;
      state.processedPostLinks.add(link);

      const card = findPostCardAncestor(link);
      if (!card) return;

      enhancePostCard(card);
    });

    markQuotedPosts(root);
  }

  function findTimelineContainer() {
    const posts = Array.from(document.querySelectorAll(".yx-post"))
      .filter((post) => !isNestedPostCard(post) && !post.classList.contains("yx-duplicate-post-hidden"));
    if (!posts.length) return null;

    const counts = new Map();
    for (const post of posts) {
      const parent = post.parentElement;
      if (!parent) continue;
      counts.set(parent, (counts.get(parent) || 0) + 1);
    }
    let best = null;
    let bestCount = 0;
    for (const [parent, count] of counts) {
      if (count > bestCount) {
        best = parent;
        bestCount = count;
      }
    }
    return best || posts[0].parentElement || null;
  }

  function isReplySectionContainer(card) {
    let el = card?.parentElement;
    for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
      const heading = el.querySelector("h1,h2,h3,h4,[role=heading]");
      if (heading && /^(返信|リプライ|repl(?:y|ies))$/i.test((heading.textContent || "").trim())) {
        return true;
      }
      const label = el.getAttribute("aria-label");
      if (label && /返信|リプライ|repl(?:y|ies)/i.test(label)) return true;
    }
    return false;
  }

  function isInlineReplyPost(card) {
    if (!card || isNestedPostCard(card) || isReplySectionContainer(card)) return false;
    const text = (card.textContent || "").replace(/\s+/g, " ").trim();
    return /@[A-Za-z0-9_\-.]+\s*(?:への返信|への返信先|に返信)/.test(text);
  }

  function hideInlineReplyPosts(root = document) {
    if (/^\/posts\/\d+\/?$/.test(location.pathname)) return;
    if (!root || root === document) return;
    const posts = Array.from(root.querySelectorAll(".yx-post"));
    for (const post of posts) {
      if (isNestedPostCard(post)) continue;
      if (post.parentElement !== root) continue;
      if (isInlineReplyPost(post)) post.classList.add("yx-inline-reply-hidden");
    }
  }

  function markQuotedPosts(root = document) {
    const posts = Array.from(root.querySelectorAll(".yx-post"));
    for (const outer of posts) {
      const nested = Array.from(outer.querySelectorAll(".yx-post"));
      for (const inner of nested) {
        if (inner === outer) continue;
        if (isReplySectionContainer(inner)) continue;
        inner.classList.add("yx-quoted-post");
      }
    }
  }

  function getNextPageUrl() {
    const url = new URL(location.href);
    const current = parseInt(url.searchParams.get(CONFIG.pageQueryParam) || "1", 10);
    const next = current + 1;
    url.searchParams.set(CONFIG.pageQueryParam, String(next));
    return { url: url.toString(), next };
  }

  async function loadNextPage() {
    if (state.isLoading || state.reachedEnd) return;
    state.isLoading = true;
    showLoadingSpinner(true);
    showLoadingProgressBar();

    try {
      const { url, next } = getNextPageUrl();
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");

      const newPostLinks = Array.from(
        doc.querySelectorAll('a[href*="/posts/"]')
      ).filter((a) => isPostDetailLink(a.getAttribute("href")));

      if (newPostLinks.length === 0) {
        state.reachedEnd = true;
        showEndMessage();
        return;
      }

      const timeline = findTimelineContainer();
      const seenCards = new Set();
      let importedCount = 0;

      newPostLinks.forEach((link) => {
        const key = postKeyFromLink(link);
        const card = findPostCardAncestorInDoc(link);
        if (!card || seenCards.has(card)) return;
        seenCards.add(card);

        const imported = document.importNode(card, true);
        if (timeline) {
          timeline.insertBefore(imported, document.getElementById("yx-loading-spinner"));
          importedCount++;
        }
      });

      if (importedCount === 0) {
        state.reachedEnd = true;
        showEndMessage();
        return;
      }

      if (timeline) {
        scanAndEnhance(timeline);
        hideInlineReplyPosts(timeline);
        markQuotedPosts(timeline);
      }

      state.currentPage = next;
    } catch (err) {
      console.warn("[yajutter-for-x] 次ページの読み込みに失敗しました:", err);
      state.reachedEnd = true;
      showEndMessage(true);
    } finally {
      state.isLoading = false;
      showLoadingSpinner(false);
      finishLoadingProgressBar();
    }
  }

  function findPostCardAncestorInDoc(postLink) {
    let el = postLink;
    for (let i = 0; i < CONFIG.maxAncestorHops && el.parentElement; i++) {
      el = el.parentElement;
      const postLinks = Array.from(el.querySelectorAll('a[href*="/posts/"]'))
        .filter((a) => isPostDetailLink(a.getAttribute("href")));
      const hasAvatar = !!el.querySelector("img");
      const hasUserLink = Array.from(el.querySelectorAll("a[href]"))
        .some((a) => isUserProfileLink(a.getAttribute("href")));
      if (postLinks.length === 1 && hasAvatar && hasUserLink) return el;
    }
    return null;
  }

  function showLoadingSpinner(visible) {
    let spinner = document.getElementById("yx-loading-spinner");
    const timeline = findTimelineContainer();
    if (!timeline) return;
    if (visible) {
      if (!spinner) {
        spinner = document.createElement("div");
        spinner.id = "yx-loading-spinner";
        spinner.className = "yx-loading-spinner";
        spinner.innerHTML =
          '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke-width="3" stroke-dasharray="50 100"></circle></svg>';
        timeline.appendChild(spinner);
      }
      spinner.style.display = "flex";
    } else if (spinner) {
      spinner.style.display = "none";
    }
  }

  function showEndMessage(isError = false) {
    const timeline = findTimelineContainer();
    if (!timeline) return;
    const msg = document.createElement("div");
    msg.className = "yx-end-message";
    msg.textContent = isError
      ? "これ以上読み込めませんでした(元のページネーションリンクから続きを確認してください)"
      : "これ以上投稿がありません";
    timeline.appendChild(msg);
  }

  function setupInfiniteScrollObserver() {
    return;
  }

  function showPostProgressBar() {
    let bar = document.getElementById("yx-post-progress");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "yx-post-progress";
      document.body.appendChild(bar);
    }
    bar.classList.remove("yx-active", "yx-done");
    bar.style.width = "0%";
    void bar.offsetWidth;
    requestAnimationFrame(() => bar.classList.add("yx-active"));
    return bar;
  }

  function finishPostProgressBar() {
    const bar = document.getElementById("yx-post-progress");
    if (!bar) return;
    bar.classList.add("yx-done");
    setTimeout(() => {
      bar.classList.remove("yx-active", "yx-done");
      bar.style.width = "0%";
    }, 350);
  }

  function showLoadingProgressBar() {
    let bar = document.getElementById("yx-post-progress");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "yx-post-progress";
      document.body.appendChild(bar);
    }
    bar.classList.remove("yx-active", "yx-loading-active", "yx-done");
    bar.style.width = "0%";
    void bar.offsetWidth;
    requestAnimationFrame(() => bar.classList.add("yx-loading-active"));
  }

  function finishLoadingProgressBar() {
    const bar = document.getElementById("yx-post-progress");
    if (!bar) return;
    bar.classList.remove("yx-active", "yx-loading-active");
    bar.classList.add("yx-done");
    setTimeout(() => {
      if (!bar.classList.contains("yx-active") && !bar.classList.contains("yx-loading-active")) {
        bar.classList.remove("yx-done");
        bar.style.width = "0%";
      }
    }, 300);
  }

  function setupActivityProgress() {
    if (document.documentElement.dataset.yxActivityProgressBound === "1") return;
    document.documentElement.dataset.yxActivityProgressBound = "1";

    let finishTimer = null;
    let activeUntil = 0;

    function beginActivity() {
      showPostProgressBar();
      activeUntil = Date.now() + 1100;
      clearTimeout(finishTimer);
      finishTimer = setTimeout(() => {
        const remaining = Math.max(0, activeUntil - Date.now());
        if (remaining > 0) {
          finishTimer = setTimeout(() => finishPostProgressBar(), remaining);
        } else {
          finishPostProgressBar();
        }
      }, 6500);
    }

    function isActionControl(el) {
      if (!(el instanceof Element)) return false;
      const control = el.closest("button, input[type='submit'], [role='button']");
      if (!control) return false;
      const label = [
        control.textContent || "",
        control.getAttribute("aria-label") || "",
        control.getAttribute("title") || "",
        control.value || ""
      ].join(" ");
      return /投稿|送信|つぶやく|返信|リプライ|コメント/.test(label);
    }

    document.addEventListener("click", (event) => {
      if (isActionControl(event.target)) beginActivity();
    }, { capture: true, passive: true });

    document.addEventListener("submit", (event) => {
      if (event.target instanceof HTMLFormElement) beginActivity();
    }, true);

    window.addEventListener("pageshow", () => finishLoadingProgressBar(), { once: true });
  }

  const TOPBAR_HEIGHT = 56;
  const TOPBAR_MAX_COLUMN_WIDTH = 480;
  const TOPBAR_MIN_COLUMN_HEIGHT = 120;
  const TOPBAR_SEEDS = ["サービス一覧", "ログインしていません", "その他"];
  const SIDEBAR_LABELS = ["ホーム", "見つける", "通知", "メッセージ", "プロフィール", "設定"];

  const finderClock = {};
  function find(key, fn, retryMs = 1500) {
    const now = Date.now();
    if (finderClock[key] && now - finderClock[key] < retryMs) return null;
    const found = fn();
    finderClock[key] = found ? 0 : now;
    return found;
  }

  function normText(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isPostLikeContainer(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    return !!el.querySelector('a[href*="/posts/"]') || el.classList.contains("yx-post");
  }

  function findSidebarContainer() {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const links = [];
    for (const label of SIDEBAR_LABELS) {
      const found = anchors.find((a) => normText(a) === label);
      if (found) links.push(found);
    }
    if (links.length < 2) return null;

    const semantic = links
      .map((el) => el.closest("nav, aside"))
      .find((el) => el && !isPostLikeContainer(el));
    if (semantic) return semantic;

    let candidate = links[0].parentElement;
    for (let depth = 0; depth < 4 && candidate; depth++, candidate = candidate.parentElement) {
      const count = SIDEBAR_LABELS.reduce((n, label) => {
        return n + (Array.from(candidate.querySelectorAll("a[href]"))
          .some((a) => normText(a) === label) ? 1 : 0);
      }, 0);
      if (count >= 2 && !isPostLikeContainer(candidate)) return candidate;
    }
    return null;
  }

  function findLogoElement() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let best = null;
    let bestScore = Infinity;
    let node;
    while ((node = walker.nextNode())) {
      if (!/ヤジュッター|yajutter/i.test(node.data)) continue;
      let el = node.parentElement;
      for (let hops = 0; el && hops < 4; hops++, el = el.parentElement) {
        if (el === document.body || el.closest(".yx-post")) break;
        const text = normText(el);
        if (text.length > 40) break;
        if (!el.querySelector("img,svg")) continue;
        const score = text.length + el.querySelectorAll("a,button").length * 20;
        if (score < bestScore) {
          best = el;
          bestScore = score;
        }
      }
    }
    return best;
  }

  function findServiceButton() {
    const candidates = document.querySelectorAll("a,button,[role=button]");
    for (const el of candidates) {
      const text = normText(el);
      const aria = (el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
      const title = (el.getAttribute("title") || "").replace(/\s+/g, " ").trim();
      if (/他のサービス|その他のサービス/.test(`${text} ${aria} ${title}`)) return el;
    }
    return null;
  }

  function findFloatingIcon(sidebar) {
    if (!sidebar) return null;
    const sideRect = sidebar.getBoundingClientRect();
    const candidates = Array.from(document.querySelectorAll("button, a, [role=button]"));
    let best = null;
    let bestScore = Infinity;

    for (const el of candidates) {
      if (sidebar.contains(el)) continue;
      if (el.closest(".yx-topbar, .yx-post, .yx-darkbox, #yx-scroll-top-btn, #yx-post-progress, #yx-toast")) continue;
      const text = (el.textContent || "").replace(/\s+/g, "").trim();
      if (text) continue;
      const icon = el.querySelector("svg, img");
      if (!icon) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.width > 96 || r.height < 24 || r.height > 96) continue;
      if (r.left < sideRect.right - 8 || r.left > sideRect.right + 140) continue;
      if (r.top < -200 || r.top > window.innerHeight + 200) continue;

      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const title = (el.getAttribute("title") || "").toLowerCase();
      const semanticBonus = /profile|account|ユーザー|プロフィール|アカウント/.test(`${aria} ${title}`) ? -500 : 0;
      const score = Math.abs(r.left - (sideRect.right + 16)) + semanticBonus;
      if (score < bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  }

  function findTextHost(text) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.data.trim() !== text) continue;
      const host = node.parentElement;
      if (host && !host.closest(".yx-real-sidebar, .yx-post, #yx-toast")) return host;
    }
    return null;
  }

  function commonAncestor(a, b) {
    for (let el = a; el; el = el.parentElement) {
      if (el.contains(b)) return el;
    }
    return null;
  }

  function hasMainContent(el) {
    if (el.querySelector(".yx-post, main, [role='main'], h2, textarea, article")) return true;
    return Array.from(el.querySelectorAll('a[href*="/posts/"]'))
      .some((a) => isPostDetailLink(a.getAttribute("href")));
  }

  function columnFromSeed(seed, anchor) {
    let start = seed.parentElement;
    if (anchor) {
      const lca = commonAncestor(seed, anchor);
      if (lca && lca !== document.body && lca !== document.documentElement) start = lca;
    }
    let best = null;
    for (let el = start, hops = 0; el && hops < 12; el = el.parentElement, hops++) {
      if (el === document.body || el === document.documentElement) break;
      if (el.matches("main, [role='main'], .yx-real-sidebar") || el.closest(".yx-real-sidebar")) break;
      if (hasMainContent(el)) break;
      const r = el.getBoundingClientRect();
      if (r.width > TOPBAR_MAX_COLUMN_WIDTH) break;
      if (r.width > 0) best = el;
    }
    return best;
  }

  function findBrownColumn() {
    const nodes = document.querySelectorAll("body > *, body div, body aside, body nav, body section, body header");
    let best = null;
    let bestScore = -Infinity;
    for (const el of nodes) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.closest(".yx-real-sidebar, .yx-post, .yx-darkbox, #yx-scroll-top-btn, #yx-post-progress, #yx-toast")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.width > 360 || r.height < Math.max(160, window.innerHeight * 0.3)) continue;
      if (r.left > window.innerWidth * 0.65) continue;
      const m = getComputedStyle(el).backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
      if (!m) continue;
      const red = Number(m[1]);
      const green = Number(m[2]);
      const blue = Number(m[3]);
      if (red < 70 || red < green * 1.35 || green < blue * 1.25) continue;
      const score = (r.height / window.innerHeight) * 1000 - Math.abs(r.width - 150);
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    }
    return best;
  }

  function findTopBar() {
    const sidebarEl = document.querySelector(".yx-real-sidebar") || findSidebarContainer();
    const logo = document.querySelector(".yx-real-sidebar-logo") || findLogoElement();
    const anchor = logo && !(sidebarEl && sidebarEl.contains(logo)) ? logo : null;

    for (const text of TOPBAR_SEEDS) {
      const seed = findTextHost(text);
      if (!seed) continue;
      let cand = columnFromSeed(seed, anchor);
      if (cand && cand.getBoundingClientRect().height < TOPBAR_MIN_COLUMN_HEIGHT) cand = null;
      if (cand && sidebarEl && (cand === sidebarEl || sidebarEl.contains(cand))) cand = null;
      if (cand) return cand;
    }

    const brown = findBrownColumn();
    if (brown && sidebarEl && (brown === sidebarEl || sidebarEl.contains(brown))) return null;
    return brown;
  }

  function tagTopBar() {
    const root = document.documentElement;
    let bar = document.querySelector(".yx-topbar");
    if (!bar) {
      bar = find("topbar", findTopBar, 800);
      if (bar) {
        bar.classList.add("yx-topbar");
        bar.addEventListener("wheel", (e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            bar.scrollLeft += e.deltaY;
            e.preventDefault();
          }
        }, { passive: false });
        console.debug("[yajutter-for-x] header bar:", bar);
      }
    }
    root.classList.toggle("yx-has-topbar", !!bar);
    root.style.setProperty("--yx-topbar-h", bar ? `${TOPBAR_HEIGHT}px` : "0px");
    return bar;
  }

  function tagSidebarNav() {
    const root = document.documentElement;
    const bar = document.querySelector(".yx-topbar");
    let sidebar = document.querySelector(".yx-real-sidebar") || find("sidebar", findSidebarContainer);
    if (sidebar && bar && (sidebar === bar || sidebar.contains(bar))) sidebar = null;

    if (sidebar) {
      sidebar.classList.add("yx-real-sidebar");
      root.classList.add("yx-sidebar-active");
    } else {
      root.classList.remove("yx-sidebar-active");
    }

    const logo = document.querySelector(".yx-real-sidebar-logo") || find("logo", findLogoElement);
    if (logo) {
      logo.classList.add("yx-real-sidebar-logo");
      logo.classList.toggle("yx-sidebar-external", !sidebar || !sidebar.contains(logo));
    }

    const service = document.querySelector(".yx-real-sidebar-service") || find("service", findServiceButton);
    if (service) {
      service.classList.add("yx-real-sidebar-service");
      service.classList.toggle("yx-sidebar-external", !sidebar || !sidebar.contains(service));
    }

    if (sidebar && !document.querySelector(".yx-floating-profile-icon")) {
      const icon = find("floating", () => findFloatingIcon(sidebar));
      if (icon) icon.classList.add("yx-floating-profile-icon");
    }
  }

  function syncSidebarOffset() {
    const sidebar = document.querySelector(".yx-real-sidebar");
    if (!sidebar) return;
    const bar = document.querySelector(".yx-topbar");
    if (bar) {
      document.documentElement.style.setProperty("--yx-sidebar-top", `${TOPBAR_HEIGHT}px`);
      return;
    }
    const headers = Array.from(document.querySelectorAll(".yx-header, header[role='banner'], header"))
      .filter((el) => !el.closest(".yx-real-sidebar"));
    const visible = headers
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.top < 80 && rect.bottom > 0)
      .sort((a, b) => b.rect.width - a.rect.width);
    const top = visible.length ? Math.max(0, Math.min(160, visible[0].rect.bottom)) : 0;
    document.documentElement.style.setProperty("--yx-sidebar-top", `${Math.round(top)}px`);
  }

  function syncFloatingIconPosition() {
    const icon = document.querySelector(".yx-floating-profile-icon");
    const sidebar = document.querySelector(".yx-real-sidebar");
    if (!icon || !sidebar) return;

    const sideRect = sidebar.getBoundingClientRect();
    const home = Array.from(sidebar.querySelectorAll("a,button,[role=button]"))
      .find((el) => normText(el) === "ホーム");
    const homeRect = home?.getBoundingClientRect();
    const barH = document.querySelector(".yx-topbar") ? TOPBAR_HEIGHT : 0;

    const left = Math.round(sideRect.right + 12);
    const top = Math.round((homeRect ? homeRect.top : 72) + ((homeRect?.height || 40) - 44) / 2);

    icon.style.setProperty("left", `${left}px`, "important");
    icon.style.setProperty("top", `${Math.max(barH + 8, top)}px`, "important");
  }

  function stabilizeFloatingElements() {
    const sidebar = document.querySelector(".yx-real-sidebar");
    if (!sidebar) return;

    for (const selector of [".yx-floating-profile-icon", ".yx-real-sidebar-service"]) {
      const el = document.querySelector(selector);
      if (!el) continue;
      let parent = el.parentElement;
      while (parent && parent !== document.body) {
        const cs = getComputedStyle(parent);
        if (cs.transform !== "none") parent.style.setProperty("transform", "none", "important");
        if (cs.perspective !== "none") parent.style.setProperty("perspective", "none", "important");
        if (cs.filter !== "none") parent.style.setProperty("filter", "none", "important");
        if (cs.backdropFilter && cs.backdropFilter !== "none") parent.style.setProperty("backdrop-filter", "none", "important");
        parent = parent.parentElement;
      }
    }
    syncSidebarOffset();
    syncFloatingIconPosition();
  }

  function tagTextMarkerWidgets(markerText, maxHops = 3) {
    if (document.querySelector(".yx-darkbox")) return;
    const target = find("welcome", () => {
      const host = findTextHost(markerText);
      if (!host) return null;
      let el = host;
      let lastSafeAncestor = el;
      for (let i = 0; i < maxHops && el.parentElement; i++) {
        const parent = el.parentElement;
        if (isPostLikeContainer(parent)) break;
        el = parent;
        lastSafeAncestor = parent;
      }
      return lastSafeAncestor;
    }, 3000);
    if (target && target !== document.body && target !== document.documentElement) {
      target.classList.add("yx-darkbox");
    }
  }

  function refreshLayout() {
    tagTopBar();
    tagSidebarNav();
    stabilizeFloatingElements();
    tagTextMarkerWidgets("ようこそ");
  }

  let layoutTimer = 0;
  function scheduleLayoutRefresh() {
    if (layoutTimer) return;
    layoutTimer = setTimeout(() => {
      layoutTimer = 0;
      refreshLayout();
    }, 150);
  }

  const SURFACE_LUM = 0.4;
  const SKIP_TAGS = new Set([
    "IMG", "VIDEO", "CANVAS", "IFRAME", "PICTURE", "SOURCE", "SCRIPT", "STYLE", "NOSCRIPT",
    "LINK", "META", "TEMPLATE", "HEAD", "TITLE", "BR", "AUDIO", "OBJECT", "EMBED", "SVG",
  ]);
  const SVG_SHAPES = new Set(["path", "circle", "rect", "line", "polyline", "polygon", "ellipse"]);
  const FIELD_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
  const BORDER_SIDES = ["Top", "Right", "Bottom", "Left"];

  const dark = {
    info: new WeakMap(),
    queue: [],
    index: 0,
    scheduled: false,
    colors: new Map(),
    ctx: null,
  };

  function parseCssColor(str) {
    if (!str) return null;
    if (str === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    const cached = dark.colors.get(str);
    if (cached !== undefined) return cached;

    let color = null;
    const m = str.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
    if (m) {
      const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      color = { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a };
    } else if (str.includes("(")) {
      try {
        dark.ctx = dark.ctx || document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        dark.ctx.globalCompositeOperation = "copy";
        dark.ctx.fillStyle = str;
        dark.ctx.fillRect(0, 0, 1, 1);
        const d = dark.ctx.getImageData(0, 0, 1, 1).data;
        color = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
      } catch {
        color = null;
      }
    }
    dark.colors.set(str, color);
    return color;
  }

  function luminance(c) {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  function saturation(c) {
    return (Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b)) / 255;
  }

  function darkInfo(el, writes) {
    const known = dark.info.get(el);
    if (known) return known;

    const parent = el.parentElement;
    const parentInfo = parent ? darkInfo(parent, writes) : { eff: 0 };
    const info = { eff: parentInfo.eff };
    dark.info.set(el, info);

    if (el.id && el.id.startsWith("yx-")) return info;
    const tag = el.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) return info;

    const cs = getComputedStyle(el);
    const classes = [];
    const isField = FIELD_TAGS.has(tag);

    const bg = parseCssColor(cs.backgroundColor);
    let converted = false;
    if (bg && bg.a >= 0.6) {
      const L = luminance(bg);
      if (L >= SURFACE_LUM) {
        converted = true;
        info.eff = 0;
        classes.push(isField ? "yx-dk-field" : "yx-dk-surface");
      } else {
        info.eff = L;
      }
    }

    let hasBorder = false;
    let lightBorder = false;
    for (const side of BORDER_SIDES) {
      if (cs[`border${side}Style`] === "none" || !(parseFloat(cs[`border${side}Width`]) > 0)) continue;
      hasBorder = true;
      const bc = parseCssColor(cs[`border${side}Color`]);
      if (bc && bc.a > 0.3 && luminance(bc) > 0.2) lightBorder = true;
    }
    if (lightBorder) classes.push("yx-dk-border");
    if (converted && !hasBorder && !isField && parseFloat(cs.borderTopLeftRadius) >= 6) {
      classes.push("yx-dk-ring");
    }

    if (info.eff < 0.2) {
      const text = parseCssColor(cs.color);
      if (text && text.a > 0.3) {
        const L = luminance(text);
        if (L < 0.12) classes.push("yx-dk-text");
        else if (L < 0.4 && saturation(text) < 0.2) classes.push("yx-dk-text-sub");
      }
      if (SVG_SHAPES.has(el.tagName.toLowerCase())) {
        const fill = parseCssColor(cs.fill);
        const stroke = parseCssColor(cs.stroke);
        if (fill && fill.a > 0.3 && luminance(fill) < 0.12) classes.push("yx-dk-fill");
        if (stroke && stroke.a > 0.3 && luminance(stroke) < 0.12) classes.push("yx-dk-stroke");
      }
    }

    if (classes.length) writes.push([el, classes]);
    return info;
  }

  function drainDark() {
    dark.scheduled = false;
    const writes = [];
    const limit = Math.min(dark.queue.length, dark.index + 600);
    for (; dark.index < limit; dark.index++) {
      const el = dark.queue[dark.index];
      if (el.isConnected) darkInfo(el, writes);
    }
    for (const [el, classes] of writes) el.classList.add(...classes);

    if (dark.index < dark.queue.length) {
      dark.scheduled = true;
      requestAnimationFrame(drainDark);
    } else {
      dark.queue = [];
      dark.index = 0;
      document.documentElement.classList.add("yx-ready");
    }
  }

  function darkenTree(root) {
    if (!(root instanceof Element)) return;
    dark.queue.push(root);
    for (const el of root.querySelectorAll("*")) dark.queue.push(el);
    if (!dark.scheduled) {
      dark.scheduled = true;
      requestAnimationFrame(drainDark);
    }
  }

  function rescanDark() {
    dark.info = new WeakMap();
    darkenTree(document.documentElement);
  }

  function setupScrollTopButton() {
    const btn = document.createElement("button");
    btn.id = "yx-scroll-top-btn";
    btn.setAttribute("aria-label", "先頭へ戻る");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M12 19V5"></path><path d="M5 12l7-7 7 7"></path></svg>';
    btn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    document.body.appendChild(btn);

    window.addEventListener(
      "scroll",
      () => {
        btn.classList.toggle("yx-visible", window.scrollY > 600);
      },
      { passive: true }
    );
  }

  const OWN_IDS = new Set(["yx-scroll-top-btn", "yx-post-progress", "yx-toast", "yx-loading-spinner"]);

  function refreshContent(root) {
    scanAndEnhance(root);
    markQuotedPosts(root);
  }

  function refreshTimeline() {
    const timeline = findTimelineContainer();
    if (timeline) hideInlineReplyPosts(timeline);
  }

  function watchRouteChanges() {
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        state.currentPage = 1;
        state.reachedEnd = false;
        refreshContent(document);
        refreshTimeline();
        darkenTree(document.body);
        refreshLayout();
      } else if (!document.querySelector(".yx-topbar") || !document.querySelector(".yx-real-sidebar")) {
        scheduleLayoutRefresh();
      }
    }, 800);
  }

  function init() {
    document.documentElement.classList.add("yx-theme");
    showLoadingProgressBar();
    refreshContent(document);
    refreshTimeline();
    refreshLayout();
    darkenTree(document.documentElement);
    setupScrollTopButton();
    setupInfiniteScrollObserver();
    setupActivityProgress();
    finishLoadingProgressBar();

    const pendingRoots = new Set();
    let flushScheduled = false;

    function flush() {
      flushScheduled = false;
      const roots = Array.from(pendingRoots);
      pendingRoots.clear();
      for (const root of roots) {
        if (!root.isConnected) continue;
        refreshContent(root);
        darkenTree(root);
      }
      refreshTimeline();
      scheduleLayoutRefresh();
    }

    const mo = new MutationObserver((mutations) => {
      if (state.observerPaused) return;
      for (const m of mutations) {
        for (const node of m.addedNodes || []) {
          if (node.nodeType !== Node.ELEMENT_NODE || OWN_IDS.has(node.id)) continue;
          pendingRoots.add(node);
        }
      }
      if (pendingRoots.size && !flushScheduled) {
        flushScheduled = true;
        requestAnimationFrame(flush);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });

    window.addEventListener("scroll", () => {
      syncSidebarOffset();
      syncFloatingIconPosition();
    }, { passive: true });
    window.addEventListener("resize", () => {
      stabilizeFloatingElements();
      syncSidebarOffset();
    }, { passive: true });
    window.addEventListener("load", () => {
      rescanDark();
      scheduleLayoutRefresh();
    }, { once: true });
    setTimeout(rescanDark, 1500);

    watchRouteChanges();
  }

  function start() {
    const root = document.documentElement;
    root.classList.add("yx-theme");
    setTimeout(() => root.classList.add("yx-ready"), 2000);

    const run = () => {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
      } else {
        init();
      }
    };

    try {
      chrome.storage.sync.get({ yxEnabled: true }, (result) => {
        if (!chrome.runtime.lastError && result.yxEnabled === false) {
          root.classList.remove("yx-theme", "yx-ready");
          return;
        }
        run();
      });
    } catch {
      run();
    }
  }

  start();
})();

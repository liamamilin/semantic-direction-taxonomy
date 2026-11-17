"use strict";

const qInput = document.getElementById("q");
const tree = document.getElementById("tree");
const article = document.getElementById("article");
const loading = document.getElementById("loading");
const statusEl = document.getElementById("filter-status");
const sidebar = document.getElementById("sidebar");
const menuBtn = document.getElementById("menu");
const backdrop = document.getElementById("backdrop");

const collapsed = new Set();
let searchCollapsed = new Set();
let query = "";
let data = null;
let visible = new Set();
let autoOpen = new Set();
let ancestors = new Map();
let branchIds = [];
let spy = null;
let currentId = "";

document.getElementById("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
});

qInput.addEventListener("input", () => {
  window.clearTimeout(qInput._timer);
  qInput._timer = window.setTimeout(() => {
    query = normalize(qInput.value);
    searchCollapsed = new Set();
    render();
  }, 70);
});

document.getElementById("expand-all").addEventListener("click", () => {
  if (query) searchCollapsed.clear();
  else collapsed.clear();
  renderTree();
});

document.getElementById("collapse-all").addEventListener("click", () => {
  if (query) {
    searchCollapsed = new Set(autoOpen);
  } else {
    for (const id of branchIds) collapsed.add(id);
  }
  renderTree();
});

tree.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-toggle]");
  if (!btn || !tree.contains(btn)) return;
  const id = btn.dataset.toggle;
  const bucket = query ? searchCollapsed : collapsed;
  if (bucket.has(id)) bucket.delete(id);
  else bucket.add(id);
  renderTree();
});

tree.addEventListener("click", (event) => {
  const link = event.target.closest("a[href^='#']");
  if (link) closeNav();
});

menuBtn.addEventListener("click", () => {
  if (sidebar.classList.contains("open")) closeNav();
  else openNav();
});

backdrop.addEventListener("click", closeNav);

window.addEventListener("resize", () => {
  if (window.innerWidth >= 900) closeNav();
  syncBar();
  syncNavA11y();
});

window.addEventListener("hashchange", () => {
  expandHash();
  renderTree();
  scrollToHash();
});

document.addEventListener("keydown", (event) => {
  const active = document.activeElement;
const typing = active === qInput || Boolean(active && active.isContentEditable);
  if (event.key === "/" && !typing) {
    event.preventDefault();
    qInput.focus();
    qInput.select();
  } else if (event.key === "Escape") {
    if (sidebar.classList.contains("open")) closeNav();
    else if (document.activeElement === qInput && qInput.value) {
      qInput.value = "";
      query = "";
      searchCollapsed = new Set();
      render();
    }
  }
});

load();

async function load() {
  try {
    const response = await fetch("data/taxonomy.json");
    if (!response.ok) throw new Error(String(response.status));
    data = await response.json();
    indexData();
    loading.hidden = true;
    article.hidden = false;
    expandHash();
    render();
    scrollToHash();
  } catch (error) {
    loading.textContent = "分类数据没有载入。请通过站点根目录访问本页。";
  }
}

function indexData() {
  ancestors = new Map();
  branchIds = [];
  for (const cat of data.categories) {
    branchIds.push(cat.id);
    const catDom = `c-${cat.id}`;
    ancestors.set(catDom, [cat.id]);
    for (const group of cat.groups) {
      branchIds.push(group.id);
      collapsed.add(group.id);
      const groupDom = `g-${group.id}`;
      ancestors.set(groupDom, [cat.id, group.id]);
      for (const leaf of group.leaves) {
        ancestors.set(`d-${leaf.id}`, [cat.id, group.id]);
      }
    }
  }
}

function render() {
  visible = collectVisible(query);
  autoOpen = new Set();
  if (query) {
    for (const cat of data.categories) {
      for (const group of cat.groups) {
        if (group.leaves.some((leaf) => visible.has(leaf.id))) {
          autoOpen.add(cat.id);
          autoOpen.add(group.id);
        }
      }
    }
  }
  renderArticle();
  renderTree();
  const shown = visible.size;
  const total = countLeaves();
  if (!query) statusEl.textContent = "";
  else if (shown === 0) statusEl.textContent = "无匹配";
  else statusEl.textContent = `${shown} / ${total}`;
  syncBar();
  bindSpy();
}

function renderArticle() {
  article.classList.toggle("is-filtering", Boolean(query));
  article.replaceChildren();

  const head = el("header", { class: "title-block" }, [
    el("div", { class: "seal", "aria-hidden": "true" }, ["向"]),
    el("div", {}, [
      el("p", { class: "kicker" }, [data.meta.titleEn]),
      el("h1", {}, [data.meta.title]),
    ]),
  ]);

  const rule = el("div", { class: "rule", "aria-hidden": "true" });
  const proem = el("div", { class: "proem" }, data.meta.intro.map((sentence) => el("p", {}, [sentence])));

  const nCat = data.categories.length;
  const nGroup = data.categories.reduce((sum, cat) => sum + cat.groups.length, 0);
  const nLeaf = countLeaves();
  const nRep = data.categories.reduce(
    (sum, cat) => sum + cat.groups.reduce(
      (inner, group) => inner + group.leaves.reduce((n, leaf) => n + leaf.representations.length, 0),
      0
    ),
    0
  );

  const stats = el("ul", { class: "stats" }, [
    stat(nCat, "大类"),
    stat(nGroup, "子类"),
    stat(nLeaf, "方向"),
    stat(nRep, "表现形式"),
  ]);

  const excluded = el("section", { class: "excluded", "aria-label": "不收录" }, [
    el("p", { class: "label" }, ["不收录"]),
    el("ul", {}, data.meta.exclusions.map((item) => el("li", {}, [
      el("span", { class: "ex-name" }, [item.name]),
    ]))),
  ]);

  const taxonomy = el("div", { class: "taxonomy" });
  let shownCats = 0;
  data.categories.forEach((cat, index) => {
    const section = renderCategory(cat, index);
    if (section) {
      taxonomy.append(section);
      shownCats += 1;
    }
  });
  if (query && shownCats === 0) {
    taxonomy.append(el("p", { class: "empty" }, ["没有匹配的语义方向。"]));
  }

  const foot = el("footer", { class: "colophon" }, [
    el("p", {}, [
      "分类数据 ",
      el("a", { href: "data/taxonomy.json" }, ["taxonomy.json"]),
    ]),
  ]);

  article.append(head, rule, proem, stats, excluded, taxonomy, foot);
}

function renderCategory(cat, index) {
  const groups = [];
  for (const group of cat.groups) {
    const leaves = group.leaves.filter((leaf) => visible.has(leaf.id));
    if (leaves.length) groups.push({ group, leaves });
  }
  if (!groups.length) return null;

  const section = el("section", { class: "cat", id: `c-${cat.id}` }, [
    el("header", {}, [
      el("p", { class: "cat-index" }, [String(index + 1).padStart(2, "0")]),
      el("h2", {}, [el("a", { href: `#c-${cat.id}` }, [highlight(cat.name, query)])]),
      el("p", { class: "cat-en", lang: "en" }, [highlight(cat.en, query)]),
    ]),
  ]);

  for (const { group, leaves } of groups) {
    const block = el("section", { class: "group", id: `g-${group.id}` }, [
      el("h3", {}, [
        el("a", { href: `#g-${group.id}` }, [highlight(group.name, query)]),
        el("span", { class: "en", lang: "en" }, [highlight(group.en, query)]),
      ]),
    ]);
    for (const leaf of leaves) block.append(renderLeaf(leaf));
    section.append(block);
  }
  return section;
}

function renderLeaf(leaf) {
  return el("article", { class: "leaf", id: `d-${leaf.id}` }, [
    el("h4", {}, [
      el("a", { href: `#d-${leaf.id}` }, [highlight(leaf.name, query)]),
      el("span", { class: "en", lang: "en" }, [highlight(leaf.en, query)]),
    ]),
    el("ul", { class: "reps", lang: "en" }, leaf.representations.map((rep) => el("li", {}, [highlight(rep, query)]))),
  ]);
}

function renderTree() {
  const scroll = tree.scrollTop;
  tree.replaceChildren();
  for (const cat of data.categories) {
    const groups = cat.groups
      .map((group) => ({ group, leaves: group.leaves.filter((leaf) => visible.has(leaf.id)) }))
      .filter((item) => item.leaves.length);
    if (!groups.length) continue;
    const total = cat.groups.reduce((sum, group) => sum + group.leaves.length, 0);
    const shown = groups.reduce((sum, item) => sum + item.leaves.length, 0);
    const open = isOpen(cat.id);
    const children = el("div", { class: "node-children" });
    children.hidden = !open;
    for (const { group, leaves } of groups) {
      const groupOpen = isOpen(group.id);
      const leafBox = el("div", { class: "node-children" });
      leafBox.hidden = !groupOpen;
      for (const leaf of leaves) {
        const bits = [el("span", {}, [highlight(leaf.name, query)])];
        if (query) {
          const reps = leaf.representations.filter((rep) => textHit(rep, query)).slice(0, 2);
          if (reps.length) bits.push(el("small", { class: "nav-rep", lang: "en" }, [reps.join(" · ")]));
        }
        const link = el("a", { class: "leaf-link", href: `#d-${leaf.id}`, title: leaf.en }, bits);
        if (currentId === `d-${leaf.id}`) link.setAttribute("aria-current", "true");
        leafBox.append(link);
      }
      const groupLink = el("a", { href: `#g-${group.id}` }, [highlight(group.name, query)]);
      if (currentId === `g-${group.id}`) groupLink.setAttribute("aria-current", "true");
      children.append(el("div", { class: "node" }, [
        el("div", { class: "node-row" }, [
          twist(group.id, groupOpen, group.name),
          groupLink,
        ]),
        leafBox,
      ]));
    }
    const catLink = el("a", { href: `#c-${cat.id}` }, [highlight(cat.name, query)]);
    if (currentId === `c-${cat.id}`) catLink.setAttribute("aria-current", "true");
    tree.append(el("div", { class: "node" }, [
      el("div", { class: "node-row" }, [
        twist(cat.id, open, cat.name),
        catLink,
        el("span", { class: "badge" }, [query ? `${shown}/${total}` : String(total)]),
      ]),
      children,
    ]));
  }
  if (!tree.childElementCount) {
    tree.append(el("p", { class: "empty" }, ["目录中无匹配。"]));
  }
  tree.scrollTop = scroll;
}

function twist(id, open, name) {
  const button = el("button", {
    type: "button",
    class: "twist",
    "data-toggle": id,
    "aria-expanded": open ? "true" : "false",
    "aria-label": `${open ? "折叠" : "展开"} ${name}`,
  }, [chevron()]);
  return button;
}

function chevron() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("chevron");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M6 3.5 11 8 6 12.5");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.5");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

function bindSpy() {
  if (spy) spy.disconnect();
  spy = new IntersectionObserver((entries) => {
    const visibleEntries = entries.filter((entry) => entry.isIntersecting);
    if (!visibleEntries.length) return;
    visibleEntries.sort((a, b) => b.intersectionRatio - a.intersectionRatio);
    setCurrent(visibleEntries[0].target.id);
  }, { rootMargin: "-12% 0px -75% 0px", threshold: [0, 0.2, 0.6] });
  document.querySelectorAll(".cat, .group, .leaf").forEach((node) => spy.observe(node));
}

function setCurrent(id) {
  if (!id || id === currentId) return;
  currentId = id;
  tree.querySelectorAll("[aria-current]").forEach((node) => node.removeAttribute("aria-current"));
  const link = tree.querySelector(`a[href="#${CSS.escape(id)}"]`);
  if (!link) return;
  link.setAttribute("aria-current", "true");
  const box = tree.getBoundingClientRect();
  const rect = link.getBoundingClientRect();
  if (rect.top < box.top) tree.scrollTop -= box.top - rect.top + 8;
  else if (rect.bottom > box.bottom) tree.scrollTop += rect.bottom - box.bottom + 8;
}

function collectVisible(q) {
  const show = new Set();
  for (const cat of data.categories) {
    for (const group of cat.groups) {
      for (const leaf of group.leaves) show.add(leaf.id);
    }
  }
  if (!q) return show;
  show.clear();
  for (const cat of data.categories) {
    const catExact = exact(cat.name, q) || exact(cat.en, q);
    let anyLeaf = false;
    const exactGroups = new Set();
    for (const group of cat.groups) {
      if (exact(group.name, q) || exact(group.en, q)) exactGroups.add(group.id);
      for (const leaf of group.leaves) {
        if (leafSelf(leaf, q)) anyLeaf = true;
      }
    }
    const prefix = hasCJK(q) && q.length >= 2 && cat.name.startsWith(q) && !exact(cat.name, q) && !anyLeaf && exactGroups.size === 0;
    for (const group of cat.groups) {
      const groupPrefix = hasCJK(q) && q.length >= 2 && group.name.startsWith(q) && !exact(group.name, q)
        && !group.leaves.some((leaf) => leafSelf(leaf, q)) && !catExact && !prefix;
      for (const leaf of group.leaves) {
        if (leafSelf(leaf, q) || catExact || exactGroups.has(group.id) || prefix || groupPrefix) {
          show.add(leaf.id);
        }
      }
    }
  }
  return show;
}

function leafSelf(leaf, q) {
  return textHit(leaf.name, q) || textHit(leaf.en, q) || leaf.representations.some((rep) => textHit(rep, q));
}

function textHit(text, q) {
  const value = normalize(text);
  if (!q) return false;
  if (hasCJK(q) || q.length >= 3) return value.includes(q);
  if (value === q) return true;
  return value.split(/[^a-z0-9]+/).some((token) => token === q);
}

function exact(text, q) {
  return normalize(text) === q;
}

function hasCJK(text) {
  return /[\u3400-\u9fff]/.test(text);
}

function normalize(text) {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function countLeaves() {
  return data.categories.reduce((sum, cat) => sum + cat.groups.reduce((inner, group) => inner + group.leaves.length, 0), 0);
}

function isOpen(id) {
  if (query) return autoOpen.has(id) && !searchCollapsed.has(id);
  return !collapsed.has(id);
}

function expandHash() {
  const id = decodeURIComponent(location.hash.replace(/^#/, ""));
  const chain = ancestors.get(id);
  if (!chain) return;
  for (const branch of chain) collapsed.delete(branch);
}

function scrollToHash() {
  const id = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (!id) return;
  const node = document.getElementById(id);
  if (!node) return;
  setCurrent(id);
  node.scrollIntoView({ block: "start" });
}

function openNav() {
  sidebar.classList.add("open");
  backdrop.hidden = false;
  menuBtn.setAttribute("aria-expanded", "true");
  document.body.style.overflow = "hidden";
  syncNavA11y();
  const focusable = sidebar.querySelector("button, a");
  if (focusable) focusable.focus();
}

function closeNav() {
  sidebar.classList.remove("open");
  backdrop.hidden = true;
  menuBtn.setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
  syncNavA11y();
}

function syncNavA11y() {
  const mobileClosed = window.innerWidth < 900 && !sidebar.classList.contains("open");
  if (mobileClosed) sidebar.setAttribute("inert", "");
  else sidebar.removeAttribute("inert");
}

function stat(count, label) {
  return el("li", {}, [el("strong", {}, [String(count)]), ` ${label}`]);
}

function highlight(text, q) {
  const span = document.createElement("span");
  if (!q) {
    span.textContent = text;
    return span;
  }
  const lower = text.toLowerCase();
  const ranges = [];
  if (hasCJK(q) || q.length >= 3) {
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(q, from);
      if (at < 0) break;
      ranges.push([at, at + q.length]);
      from = at + q.length;
    }
  } else {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|[^a-z0-9])(${escaped})(?=$|[^a-z0-9])`, "gi");
    let match;
    while ((match = pattern.exec(lower))) {
      const start = match.index + match[1].length;
      ranges.push([start, start + match[2].length]);
      if (pattern.lastIndex === match.index) pattern.lastIndex += 1;
    }
  }
  if (!ranges.length) {
    span.textContent = text;
    return span;
  }
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) span.append(document.createTextNode(text.slice(cursor, start)));
    const mark = document.createElement("mark");
    mark.textContent = text.slice(start, end);
    span.append(mark);
    cursor = end;
  }
  if (cursor < text.length) span.append(document.createTextNode(text.slice(cursor)));
  return span;
}

function syncBar() {
  const bar = document.querySelector(".topbar");
  if (bar) document.documentElement.style.setProperty("--bar", `${bar.offsetHeight}px`);
}

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children || []) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

syncBar();
syncNavA11y();
if (document.fonts) document.fonts.ready.then(syncBar);

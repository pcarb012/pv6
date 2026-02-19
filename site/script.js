(function () {
  "use strict";

  // ===== Page registry =====
  // Maps data-page attributes to display names for search
  const PAGE_REGISTRY = [];
  document.querySelectorAll(".nav-link[data-page]").forEach(function (link) {
    PAGE_REGISTRY.push({
      page: link.dataset.page,
      title: link.textContent.trim(),
    });
  });

  // ===== State =====
  let currentPage = "README.md";
  let pageCache = {};
  let searchIndex = []; // { page, title, content }

  // ===== DOM refs =====
  const markdownBody = document.getElementById("markdown-body");
  const sidebar = document.getElementById("sidebar");
  const sidebarToggle = document.getElementById("sidebar-toggle");
  const sidebarOverlay = document.getElementById("sidebar-overlay");
  const themeToggle = document.getElementById("theme-toggle");
  const iconLight = document.getElementById("theme-icon-light");
  const iconDark = document.getElementById("theme-icon-dark");
  const searchInput = document.getElementById("search-input");
  const searchModal = document.getElementById("search-modal");
  const searchModalInput = document.getElementById("search-modal-input");
  const searchResults = document.getElementById("search-results");
  const searchBackdrop = document.getElementById("search-modal-backdrop");

  // ===== Theme =====
  function getPreferredTheme() {
    var stored = localStorage.getItem("pv6-theme");
    if (stored) return stored;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("pv6-theme", theme);
    if (theme === "dark") {
      iconLight.style.display = "none";
      iconDark.style.display = "block";
    } else {
      iconLight.style.display = "block";
      iconDark.style.display = "none";
    }
  }

  applyTheme(getPreferredTheme());

  themeToggle.addEventListener("click", function () {
    var current = document.documentElement.getAttribute("data-theme");
    applyTheme(current === "dark" ? "light" : "dark");
  });

  // ===== Sidebar toggle (mobile) =====
  function openSidebar() {
    sidebar.classList.add("open");
    sidebarOverlay.classList.add("open");
  }
  function closeSidebar() {
    sidebar.classList.remove("open");
    sidebarOverlay.classList.remove("open");
  }

  sidebarToggle.addEventListener("click", function () {
    if (sidebar.classList.contains("open")) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });
  sidebarOverlay.addEventListener("click", closeSidebar);

  // ===== Configure marked =====
  if (typeof marked !== "undefined") {
    marked.setOptions({
      gfm: true,
      breaks: false,
    });
  }

  // ===== Navigation =====
  function setActiveLink(page) {
    document.querySelectorAll(".nav-link").forEach(function (link) {
      link.classList.toggle("active", link.dataset.page === page);
    });
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function loadPage(page) {
    if (currentPage === page && markdownBody.innerHTML && !document.getElementById("loading")) {
      return;
    }

    currentPage = page;
    setActiveLink(page);

    // Update URL hash
    history.pushState(null, "", "#" + page);

    // Show loading state
    markdownBody.innerHTML = '<div id="loading">Loading documentation...</div>';
    scrollToTop();

    try {
      var content;
      if (pageCache[page]) {
        content = pageCache[page];
      } else {
        var response = await fetch(page);
        if (!response.ok) throw new Error("Failed to load " + page);
        content = await response.text();
        pageCache[page] = content;
      }

      // Render markdown
      var html = marked.parse(content);
      markdownBody.innerHTML = html;

      // Add anchor links to headings
      markdownBody.querySelectorAll("h1, h2, h3, h4").forEach(function (heading) {
        var id = heading.textContent
          .toLowerCase()
          .replace(/[^\w\s-]/g, "")
          .replace(/\s+/g, "-");
        heading.id = id;
        var anchor = document.createElement("a");
        anchor.className = "anchor";
        anchor.href = "#" + id;
        anchor.textContent = "#";
        heading.appendChild(anchor);
      });

      // Close sidebar on mobile after navigation
      closeSidebar();
    } catch (err) {
      markdownBody.innerHTML =
        '<div id="loading">Failed to load page: ' + page + "<br><br>" +
        '<span style="color:var(--text-muted)">Make sure you are serving this site from a local web server.<br>' +
        'Try: <code>python3 -m http.server 8000</code> then open <code>http://localhost:8000</code></span></div>';
    }
  }

  // Handle nav clicks
  document.addEventListener("click", function (e) {
    var link = e.target.closest("[data-page]");
    if (link) {
      e.preventDefault();
      loadPage(link.dataset.page);
    }
  });

  // Handle browser back/forward
  window.addEventListener("popstate", function () {
    var page = location.hash.slice(1) || "README.md";
    loadPage(page);
  });

  // ===== Search =====
  async function buildSearchIndex() {
    var promises = PAGE_REGISTRY.map(async function (entry) {
      try {
        var content;
        if (pageCache[entry.page]) {
          content = pageCache[entry.page];
        } else {
          var response = await fetch(entry.page);
          if (!response.ok) return null;
          content = await response.text();
          pageCache[entry.page] = content;
        }
        return {
          page: entry.page,
          title: entry.title,
          content: content,
        };
      } catch (err) {
        return null;
      }
    });

    var results = await Promise.all(promises);
    searchIndex = results.filter(function (r) { return r !== null; });
  }

  function searchDocs(query) {
    if (!query || query.length < 2) return [];

    var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    var scored = [];

    searchIndex.forEach(function (entry) {
      var lower = entry.content.toLowerCase();
      var titleLower = entry.title.toLowerCase();
      var score = 0;
      var matchedAll = true;

      terms.forEach(function (term) {
        if (titleLower.includes(term)) {
          score += 10;
        }
        var idx = lower.indexOf(term);
        if (idx !== -1) {
          score += 1;
          // count occurrences (up to 5)
          var count = 0;
          var pos = 0;
          while (pos < lower.length && count < 5) {
            pos = lower.indexOf(term, pos);
            if (pos === -1) break;
            count++;
            pos += term.length;
          }
          score += count;
        } else {
          matchedAll = false;
        }
      });

      if (matchedAll && score > 0) {
        // Find a snippet
        var snippet = "";
        var firstTerm = terms[0];
        var snipIdx = lower.indexOf(firstTerm);
        if (snipIdx !== -1) {
          var start = Math.max(0, snipIdx - 60);
          var end = Math.min(entry.content.length, snipIdx + firstTerm.length + 100);
          snippet = (start > 0 ? "..." : "") + entry.content.slice(start, end).replace(/\n/g, " ") + (end < entry.content.length ? "..." : "");
        }

        scored.push({
          page: entry.page,
          title: entry.title,
          score: score,
          snippet: snippet,
        });
      }
    });

    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, 15);
  }

  function highlightSnippet(text, query) {
    if (!text || !query) return text;
    var terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    var result = text;
    terms.forEach(function (term) {
      var regex = new RegExp("(" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "gi");
      result = result.replace(regex, "<mark>$1</mark>");
    });
    return result;
  }

  function renderSearchResults(query) {
    var results = searchDocs(query);

    if (results.length === 0) {
      searchResults.innerHTML = '<div class="search-empty">No results found for "' +
        query.replace(/</g, "&lt;") + '"</div>';
      return;
    }

    searchResults.innerHTML = results
      .map(function (r) {
        return (
          '<div class="search-result" data-page="' + r.page + '">' +
          '<div class="search-result-title">' + highlightSnippet(r.title, query) + "</div>" +
          '<div class="search-result-path">' + r.page + "</div>" +
          (r.snippet ? '<div class="search-result-snippet">' + highlightSnippet(r.snippet.replace(/</g, "&lt;").replace(/>/g, "&gt;"), query) + "</div>" : "") +
          "</div>"
        );
      })
      .join("");
  }

  function openSearch() {
    searchModal.className = "modal-visible";
    searchModalInput.value = "";
    searchResults.innerHTML = '<div class="search-empty">Type to search across all documentation pages</div>';
    setTimeout(function () { searchModalInput.focus(); }, 50);
  }

  function closeSearch() {
    searchModal.className = "modal-hidden";
  }

  // Search input in header opens modal
  searchInput.addEventListener("focus", function () {
    openSearch();
    searchInput.blur();
  });

  searchBackdrop.addEventListener("click", closeSearch);

  searchModalInput.addEventListener("input", function () {
    renderSearchResults(searchModalInput.value.trim());
  });

  // Click search result
  searchResults.addEventListener("click", function (e) {
    var result = e.target.closest(".search-result");
    if (result) {
      closeSearch();
      loadPage(result.dataset.page);
    }
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", function (e) {
    // Ctrl+K or Cmd+K to open search
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      if (searchModal.className === "modal-visible") {
        closeSearch();
      } else {
        openSearch();
      }
    }

    // Escape to close search
    if (e.key === "Escape" && searchModal.className === "modal-visible") {
      closeSearch();
    }
  });

  // ===== Initial load =====
  var initialPage = location.hash.slice(1) || "README.md";
  loadPage(initialPage);

  // Build search index in background
  setTimeout(buildSearchIndex, 500);
})();

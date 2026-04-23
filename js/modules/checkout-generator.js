const API_BASE = "https://ezweystock.petrix.id/gpt";
const NOTIFY_API_PATH = "/api/notify";

export function mountCheckoutGenerator(root) {
  if (!root) return null;

  const state = {
    selectedPlan: "team",
    currencies: [],
    filteredCurrencies: [],
    selectedCurrency: null,
    highlightedIndex: -1,
    generatedUrl: "",
    isLoading: false
  };

  const els = cacheElements(root);
  bindEvents();
  init();

  return {
    refresh: init
  };

  function cacheElements(scope) {
    return {
      planCards: Array.from(scope.querySelectorAll("[data-plan]")),
      priceLabels: Array.from(scope.querySelectorAll("[data-price]")),
      statTotal: scope.querySelector("#cg-stat-total"),
      statTeam: scope.querySelector("#cg-stat-team"),
      statPlus: scope.querySelector("#cg-stat-plus"),
      dropdown: scope.querySelector("#cg-country-dropdown"),
      dropdownInputWrap: scope.querySelector("#cg-dropdown-input-wrap"),
      countrySearch: scope.querySelector("#cg-country-search"),
      countryMenu: scope.querySelector("#cg-country-menu"),
      countryToggle: scope.querySelector("#cg-country-toggle"),
      currencyCode: scope.querySelector("#cg-currency-code"),
      paymentMethod: scope.querySelector("#cg-payment-method"),
      sessionInput: scope.querySelector("#cg-session-input"),
      generateBtn: scope.querySelector("#cg-generate-btn"),
      loadingState: scope.querySelector("#cg-loading-state"),
      successBox: scope.querySelector("#cg-success-box"),
      errorBox: scope.querySelector("#cg-error-box"),
      errorMsg: scope.querySelector("#cg-error-msg"),
      resultUrl: scope.querySelector("#cg-result-url"),
      copyBtn: scope.querySelector("#cg-copy-btn"),
      openBtn: scope.querySelector("#cg-open-btn")
    };
  }

  function bindEvents() {
    els.planCards.forEach((card) => {
      card.addEventListener("click", () => selectPlan(card.dataset.plan));
    });

    els.countrySearch.addEventListener("focus", handleCountryFocus);
    els.countrySearch.addEventListener("input", handleCountrySearch);
    els.countrySearch.addEventListener("keydown", handleCountryKeydown);
    els.countryToggle.addEventListener("click", toggleCountryDropdown);
    els.dropdownInputWrap.addEventListener("click", handleCountryBarClick);
    els.generateBtn.addEventListener("click", generatePaymentLink);
    els.copyBtn.addEventListener("click", copyGeneratedLink);
    els.openBtn.addEventListener("click", openGeneratedLink);

    document.addEventListener("click", (event) => {
      if (!els.dropdown.contains(event.target)) {
        closeCountryDropdown({ restoreSelectedLabel: true });
      }
    });
  }

  async function init() {
    els.generateBtn.disabled = true;
    await Promise.allSettled([loadStats(), loadCurrencies()]);
    els.generateBtn.disabled = false;
  }

  async function loadStats() {
    try {
      const response = await fetch(`${API_BASE}/stats`);
      if (!response.ok) throw new Error("Failed to load stats");
      const data = await response.json();
      els.statTotal.textContent = formatNumber(data.total);
      els.statTeam.textContent = formatNumber(data.team);
      els.statPlus.textContent = formatNumber(data.plus);
    } catch {
      els.statTotal.textContent = "0";
      els.statTeam.textContent = "0";
      els.statPlus.textContent = "0";
    }
  }

  async function loadCurrencies() {
    const apiUrl = `${API_BASE}/currency`;
    const fallbackProxyUrl = `https://corsproxy.io/?${encodeURIComponent(apiUrl)}`;

    try {
      let response;
      try {
        response = await fetch(apiUrl, { mode: "cors" });
        if (!response.ok) throw new Error(`Direct lỗi ${response.status}`);
      } catch {
        response = await fetch(fallbackProxyUrl);
        if (!response.ok) throw new Error(`Proxy lỗi ${response.status}`);
      }

      const data = await response.json();
      state.currencies = Array.isArray(data) ? data : [];
      state.filteredCurrencies = [...state.currencies];

      const defaultItem = state.currencies.find((item) => item && !item.separator);
      if (defaultItem) {
        selectCurrency(defaultItem);
      }

      renderCountryMenu();
    } catch {
      showError("Không tải được danh sách quốc gia. Thử refresh hoặc kiểm tra mạng.");
    }
  }

  function selectPlan(plan) {
    state.selectedPlan = plan;
    els.planCards.forEach((card) => {
      const active = card.dataset.plan === plan;
      card.classList.toggle("is-active", active);
      card.setAttribute("aria-pressed", String(active));
    });
  }

  function handleCountryFocus() {
    state.filteredCurrencies = state.currencies.slice();
    els.countrySearch.select();
    openCountryDropdown();
  }

  function handleCountrySearch() {
    state.filteredCurrencies = buildFilteredCurrencies(els.countrySearch.value);
    state.highlightedIndex = firstSelectableIndex(state.filteredCurrencies);
    openCountryDropdown();
    renderCountryMenu();
  }

  function handleCountryBarClick(event) {
    if (event.target.closest("#cg-country-toggle")) return;
    state.filteredCurrencies = state.currencies.slice();
    openCountryDropdown();
    els.countrySearch.focus();
  }

  function handleCountryKeydown(event) {
    if (!isCountryDropdownOpen() && ["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
      event.preventDefault();
      openCountryDropdown();
      return;
    }

    const selectableItems = state.filteredCurrencies.filter((item) => !item.separator);
    if (!selectableItems.length) {
      if (event.key === "Escape") closeCountryDropdown({ restoreSelectedLabel: true });
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const item = selectableItems[state.highlightedIndex];
      if (item) selectCurrency(item);
    }

    if (event.key === "Escape") {
      closeCountryDropdown({ restoreSelectedLabel: true });
      els.countrySearch.blur();
    }
  }

  function toggleCountryDropdown() {
    if (isCountryDropdownOpen()) {
      closeCountryDropdown({ restoreSelectedLabel: true });
      return;
    }

    state.filteredCurrencies = state.currencies.slice();
    openCountryDropdown();
    els.countrySearch.focus();
  }

  function openCountryDropdown() {
    els.dropdown.classList.add("is-open");
    els.countrySearch.setAttribute("aria-expanded", "true");
    state.highlightedIndex = getSelectedIndex(state.filteredCurrencies);
    if (state.highlightedIndex === -1) {
      state.highlightedIndex = firstSelectableIndex(state.filteredCurrencies);
    }
    renderCountryMenu();
  }

  function closeCountryDropdown({ restoreSelectedLabel = false } = {}) {
    els.dropdown.classList.remove("is-open");
    els.countrySearch.setAttribute("aria-expanded", "false");
    if (restoreSelectedLabel && state.selectedCurrency) {
      els.countrySearch.value = state.selectedCurrency.label;
    }
  }

  function isCountryDropdownOpen() {
    return els.dropdown.classList.contains("is-open");
  }

  function moveHighlight(direction) {
    const selectableItems = state.filteredCurrencies.filter((item) => !item.separator);
    if (!selectableItems.length) {
      state.highlightedIndex = -1;
      renderCountryMenu();
      return;
    }

    if (state.highlightedIndex === -1) {
      state.highlightedIndex = 0;
    } else {
      const nextIndex = state.highlightedIndex + direction;
      if (nextIndex < 0) {
        state.highlightedIndex = selectableItems.length - 1;
      } else if (nextIndex >= selectableItems.length) {
        state.highlightedIndex = 0;
      } else {
        state.highlightedIndex = nextIndex;
      }
    }

    renderCountryMenu();
    scrollHighlightedItemIntoView();
  }

  function renderCountryMenu() {
    els.countryMenu.innerHTML = "";

    if (!state.filteredCurrencies.length) {
      els.countryMenu.innerHTML = '<div class="dropdown-empty">No matching country found.</div>';
      return;
    }

    let selectableIndex = -1;
    let shouldRenderPopularLabel = true;

    state.filteredCurrencies.forEach((item) => {
      if (item.separator) {
        shouldRenderPopularLabel = false;
        const divider = document.createElement("div");
        divider.className = "dropdown-divider";
        els.countryMenu.appendChild(divider);

        const groupLabel = document.createElement("div");
        groupLabel.className = "dropdown-group-label";
        groupLabel.textContent = "All Countries";
        els.countryMenu.appendChild(groupLabel);
        return;
      }

      selectableIndex += 1;
      if (shouldRenderPopularLabel && selectableIndex === 0 && includesSeparator(state.filteredCurrencies)) {
        const groupLabel = document.createElement("div");
        groupLabel.className = "dropdown-group-label";
        groupLabel.textContent = "Popular";
        els.countryMenu.appendChild(groupLabel);
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "dropdown-item";
      button.dataset.index = String(selectableIndex);
      button.dataset.key = item.key;

      const isHighlighted = selectableIndex === state.highlightedIndex;
      const isSelected = state.selectedCurrency && state.selectedCurrency.key === item.key;
      if (isHighlighted) button.classList.add("is-active");
      if (isSelected) button.classList.add("is-selected");

      button.innerHTML = `
        <span class="dropdown-item__main">
          <span class="dropdown-item__flag">${countryFlag(item.country)}</span>
          <span class="dropdown-item__texts">
            <span class="dropdown-item__title">${escapeHtml(item.key)}</span>
            <span class="dropdown-item__subtitle">${escapeHtml(item.label)}</span>
          </span>
        </span>
        <span class="dropdown-item__meta">${escapeHtml(item.currency)}</span>
      `;

      button.addEventListener("mouseenter", () => {
        setHighlightedIndex(selectableIndex);
      });

      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        selectCurrency(item);
      });

      els.countryMenu.appendChild(button);
    });
  }

  function selectCurrency(item, { keepMenuOpen = false } = {}) {
    state.selectedCurrency = item;
    els.currencyCode.value = item.key;
    els.countrySearch.value = item.label;
    updatePlanPrices(item.currency);
    renderCountryMenu();

    if (!keepMenuOpen) {
      closeCountryDropdown({ restoreSelectedLabel: false });
    }
  }

  function updatePlanPrices(currency) {
    els.priceLabels.forEach((label) => {
      label.textContent = `${currency} 0`;
    });
  }

  async function generatePaymentLink() {
    const sessionInput = els.sessionInput.value.trim();
    const currency = els.currencyCode.value;
    const paymentMethod = els.paymentMethod.value || "shortlink";

    hideFeedback();

    if (!currency) {
      showError("Vui lòng chọn quốc gia / currency trước khi tạo link.");
      return;
    }

    if (!sessionInput) {
      showError("Vui lòng paste session JSON hoặc accessToken.");
      return;
    }

    const session = parseSessionInput(sessionInput);
    if (!session) {
      showError("Session không hợp lệ. Hãy paste full JSON hoặc accessToken hợp lệ.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(`${API_BASE}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: state.selectedPlan,
          payment: paymentMethod,
          currency,
          session
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success || !data.url) {
        throw new Error(data.msg || "Không thể tạo checkout link.");
      }

      state.generatedUrl = data.url;
      els.resultUrl.value = data.url;
      els.successBox.classList.remove("is-hidden");

      const sessionFingerprint = await createSessionFingerprint(session);
      await sendToTelegramNotification({
        plan: state.selectedPlan,
        country: currency,
        paymentType: paymentMethod,
        url: data.url,
        sessionFingerprint
      });
      await loadStats();
    } catch (error) {
      showError(error.message || "Có lỗi xảy ra khi tạo payment link.");
    } finally {
      setLoading(false);
    }
  }

  async function sendToTelegramNotification(payload) {
    try {
      await fetch(NOTIFY_API_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch {
      // best effort only
    }
  }

  async function createSessionFingerprint(session) {
    try {
      const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(session));
      const digest = Array.from(new Uint8Array(buffer))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      return `${digest.slice(0, 12)}...`;
    } catch {
      return `len:${session.length}`;
    }
  }

  function parseSessionInput(rawValue) {
    if (!rawValue) return "";
    try {
      const parsed = JSON.parse(rawValue);
      if (typeof parsed === "string") return parsed.trim();
      const token = findAccessToken(parsed);
      return token ? token.trim() : "";
    } catch {
      return rawValue;
    }
  }

  function findAccessToken(value) {
    if (!value || typeof value !== "object") return "";
    if (typeof value.accessToken === "string" && value.accessToken.trim()) {
      return value.accessToken;
    }
    for (const nestedValue of Object.values(value)) {
      if (!nestedValue || typeof nestedValue !== "object") continue;
      const nestedToken = findAccessToken(nestedValue);
      if (nestedToken) return nestedToken;
    }
    return "";
  }

  function showError(message) {
    els.errorMsg.textContent = message;
    els.errorBox.classList.remove("is-hidden");
  }

  function hideFeedback() {
    els.successBox.classList.add("is-hidden");
    els.errorBox.classList.add("is-hidden");
  }

  function setLoading(isLoading) {
    state.isLoading = isLoading;
    els.generateBtn.disabled = isLoading;
    els.generateBtn.classList.toggle("is-hidden", isLoading);
    els.loadingState.classList.toggle("is-hidden", !isLoading);
  }

  async function copyGeneratedLink() {
    if (!state.generatedUrl) return;
    try {
      await navigator.clipboard.writeText(state.generatedUrl);
      const original = els.copyBtn.innerHTML;
      els.copyBtn.innerHTML = '<i class="fa-solid fa-check"></i><span>Copied</span>';
      window.setTimeout(() => {
        els.copyBtn.innerHTML = original;
      }, 1800);
    } catch {
      showError("Không copy được link. Hãy thử lại thủ công.");
    }
  }

  function openGeneratedLink() {
    if (!state.generatedUrl) return;
    window.open(state.generatedUrl, "_blank", "noopener,noreferrer");
  }

  function buildFilteredCurrencies(query) {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return state.currencies.slice();
    return state.currencies.filter((item) => {
      if (item.separator) return false;
      const haystack = `${item.key} ${item.label} ${item.currency} ${item.country}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }

  function includesSeparator(items) {
    return items.some((item) => item.separator);
  }

  function getSelectedIndex(items) {
    if (!state.selectedCurrency) return -1;
    return items.filter((item) => !item.separator).findIndex((item) => item.key === state.selectedCurrency.key);
  }

  function firstSelectableIndex(items) {
    return items.findIndex((item) => !item.separator);
  }

  function scrollHighlightedItemIntoView() {
    const highlighted = els.countryMenu.querySelector(".dropdown-item.is-active");
    highlighted?.scrollIntoView({ block: "nearest" });
  }

  function setHighlightedIndex(index) {
    state.highlightedIndex = index;
    const items = Array.from(els.countryMenu.querySelectorAll(".dropdown-item"));
    items.forEach((itemElement, itemIndex) => {
      itemElement.classList.toggle("is-active", itemIndex === index);
    });
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString("en-US");
  }

  function countryFlag(countryCode) {
    if (!countryCode || countryCode.length !== 2) return "🌍";
    return countryCode
      .toUpperCase()
      .split("")
      .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
      .join("");
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
}

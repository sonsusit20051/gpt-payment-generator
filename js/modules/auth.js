const API_BASE = window.location.protocol === "file:" ? "http://localhost:3000" : "";
const AUTH_STORAGE_KEY = "mMoiTelegramAuth";
const TEAM_STORAGE_KEY = "teams";
const GENERATED_LINK_COUNT_STORAGE_KEY = "mMoiGeneratedLinkCount";

export function mountTelegramAuth() {
  const els = cacheElements();
  if (!els.openButton || !els.modal) return null;

  const state = {
    session: loadStoredSession(),
    botMeta: {
      configured: false,
      botUsername: "",
      botLink: ""
    },
    busy: false,
    statusTimer: null
  };

  bindEvents();
  syncBotLinks();
  render();
  init();

  return {
    isLoggedIn,
    getAuthToken,
    getSession,
    ensureAuthenticated,
    openModal,
    logout,
    handleUnauthorized,
    onChange
  };

  function cacheElements() {
    return {
      openButton: document.getElementById("auth-open-button"),
      userLabel: document.getElementById("auth-user-label"),
      telegramLink: document.getElementById("auth-telegram-link"),
      modal: document.getElementById("auth-login-modal"),
      modalTitle: document.getElementById("auth-modal-title"),
      modalSubtitle: document.getElementById("auth-modal-subtitle"),
      closeButtons: Array.from(document.querySelectorAll("[data-auth-close]")),
      statusBanner: document.getElementById("auth-status-banner"),
      loggedOutView: document.getElementById("auth-logged-out-view"),
      loggedInView: document.getElementById("auth-logged-in-view"),
      identifierInput: document.getElementById("auth-telegram-identifier"),
      codeInput: document.getElementById("auth-telegram-code"),
      requestCodeButton: document.getElementById("auth-request-code-button"),
      verifyButton: document.getElementById("auth-verify-button"),
      openBotButton: document.getElementById("auth-open-bot-button"),
      logoutButton: document.getElementById("auth-logout-button"),
      sessionName: document.getElementById("auth-session-name"),
      sessionMeta: document.getElementById("auth-session-meta"),
      sessionExpiry: document.getElementById("auth-session-expiry")
    };
  }

  function bindEvents() {
    els.openButton.addEventListener("click", () => {
      openModal();
    });

    els.closeButtons.forEach((button) => {
      button.addEventListener("click", closeModal);
    });

    els.requestCodeButton.addEventListener("click", requestCode);
    els.verifyButton.addEventListener("click", verifyCode);
    els.logoutButton.addEventListener("click", () => logout({ notifyServer: true }));

    els.identifierInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        requestCode();
      }
    });

    els.codeInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        verifyCode();
      }
    });
  }

  async function init() {
    await loadBotMeta();
    await validateStoredSession();
    render();
  }

  function onChange(callback) {
    if (typeof callback !== "function") return () => {};
    const eventName = "m-moi-auth-change";

    const handler = (event) => {
      callback(event.detail || null);
    };

    window.addEventListener(eventName, handler);
    return () => window.removeEventListener(eventName, handler);
  }

  function emitChange() {
    window.dispatchEvent(new CustomEvent("m-moi-auth-change", {
      detail: state.session
    }));
  }

  function isLoggedIn() {
    if (!state.session?.authToken) return false;
    if (!state.session?.expiresAt) return true;
    return new Date(state.session.expiresAt).getTime() > Date.now();
  }

  function getAuthToken() {
    return isLoggedIn() ? state.session?.authToken || "" : "";
  }

  function getSession() {
    return isLoggedIn() ? state.session : null;
  }

  function loadStoredSession() {
    try {
      const raw = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) || "null");
      if (!raw?.authToken) return null;
      return raw;
    } catch {
      return null;
    }
  }

  function persistSession(session) {
    state.session = session || null;
    if (session) {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    }
    render();
    emitChange();
  }

  async function loadBotMeta() {
    try {
      const data = await fetchJson("/auth/telegram/meta");
      state.botMeta = {
        configured: Boolean(data.configured),
        botUsername: data.botUsername || "",
        botLink: data.botLink || ""
      };
    } catch {
      state.botMeta = {
        configured: false,
        botUsername: "",
        botLink: ""
      };
    }
    syncBotLinks();
  }

  async function validateStoredSession() {
    try {
      const data = await fetchJson("/auth/telegram/session", {
        headers: buildAuthHeaders()
      });
      persistSession({
        ...(state.session || {}),
        authToken: data.authToken || state.session?.authToken || "",
        ...data.session
      });
    } catch {
      persistSession(null);
    }
  }

  function syncBotLinks() {
    const hasLink = Boolean(state.botMeta.botLink);
    const linkTargets = [els.openBotButton];

    linkTargets.forEach((link) => {
      if (!link) return;
      if (hasLink) {
        link.href = state.botMeta.botLink;
        link.classList.remove("is-disabled");
        link.removeAttribute("aria-disabled");
        link.removeAttribute("tabindex");
      } else {
        link.href = "#";
        link.classList.add("is-disabled");
        link.setAttribute("aria-disabled", "true");
        link.setAttribute("tabindex", "-1");
      }
    });
  }

  function render() {
    const loggedIn = isLoggedIn();
    const session = state.session;
    const displayName = loggedIn
      ? session.displayName || session.username || `ID ${session.telegramId || "?"}`
      : "Đăng nhập";

    els.userLabel.textContent = displayName;
    els.openButton.classList.toggle("is-authenticated", loggedIn);
    els.loggedOutView.classList.toggle("is-hidden", loggedIn);
    els.loggedInView.classList.toggle("is-hidden", !loggedIn);

    if (loggedIn) {
      const usernameText = session.username ? `@${session.username}` : "Không có username";
      els.modalTitle.textContent = "Telegram Login";
      els.modalSubtitle.textContent = "";
      els.modalSubtitle.classList.add("is-hidden");
      els.sessionName.textContent = session.displayName || usernameText;
      els.sessionMeta.textContent = `${usernameText} • ID ${session.telegramId || "?"}`;
      els.sessionExpiry.textContent = session.expiresAt
        ? `Hết hạn: ${formatDate(session.expiresAt)}`
        : "Không có thời hạn";
    } else {
      els.modalTitle.textContent = "Đăng nhập bằng Telegram";
      els.modalSubtitle.textContent = "";
      els.modalSubtitle.classList.add("is-hidden");
      els.sessionName.textContent = "";
      els.sessionMeta.textContent = "";
      els.sessionExpiry.textContent = "";
    }

    const busy = state.busy;
    els.identifierInput.disabled = busy || loggedIn;
    els.codeInput.disabled = busy || loggedIn;
    els.requestCodeButton.disabled = busy || loggedIn || !state.botMeta.configured;
    els.verifyButton.disabled = busy || loggedIn || !state.botMeta.configured;
    els.logoutButton.disabled = busy || !loggedIn;
  }

  function openModal(options = {}) {
    const { reason = "", preserveCode = false } = options;
    if (!preserveCode) {
      els.codeInput.value = "";
    }
    if (reason) {
      showStatus(reason, "warning", true);
    } else {
      hideStatus();
    }
    els.modal.classList.remove("is-hidden");
    window.setTimeout(() => {
      if (!isLoggedIn()) {
        els.identifierInput.focus();
      }
    }, 0);
  }

  function closeModal() {
    els.modal.classList.add("is-hidden");
    hideStatus();
  }

  function ensureAuthenticated(options = {}) {
    if (isLoggedIn()) return true;
    openModal({
      reason: options.reason || "Đăng nhập Telegram để tiếp tục dùng Team Manager.",
      preserveCode: true
    });
    return false;
  }

  async function requestCode() {
    const identifier = els.identifierInput.value.trim();
    if (!identifier) {
      showStatus("Nhập Telegram ID hoặc username trước khi xin mã.", "warning", true);
      return;
    }

    await withBusy(async () => {
      showStatus("Đang gửi mã đăng nhập qua Telegram...", "info", true);
      const data = await fetchJson("/auth/telegram/request-code", {
        method: "POST",
        body: JSON.stringify({ identifier })
      });
      showStatus(data.message || "Bot đã gửi mã đăng nhập cho bạn.", "success", true);
      els.codeInput.focus();
    });
  }

  async function verifyCode() {
    const identifier = els.identifierInput.value.trim();
    const code = els.codeInput.value.trim();

    if (!identifier) {
      showStatus("Nhập Telegram ID hoặc username trước khi xác thực.", "warning", true);
      return;
    }

    if (!code) {
      showStatus("Nhập mã đăng nhập vừa nhận từ bot.", "warning", true);
      return;
    }

    await withBusy(async () => {
      const data = await fetchJson("/auth/telegram/verify-code", {
        method: "POST",
        body: JSON.stringify({
          identifier,
          code,
          clientStats: collectClientStats()
        })
      });

      persistSession({
        authToken: data.authToken,
        ...data.session
      });
      showStatus("Đăng nhập thành công, sếp cần gì thì hú @sonmoi2409 nhé", "success", true);
      els.codeInput.value = "";

      window.setTimeout(() => {
        closeModal();
        hideStatus();
      }, 700);
    });
  }

  async function logout(options = {}) {
    const { notifyServer = false, silent = false } = options;
    const currentToken = state.session?.authToken || "";

    if (notifyServer) {
      try {
        await fetchJson("/auth/telegram/logout", {
          method: "POST",
          headers: buildAuthHeaders(currentToken)
        });
      } catch {
        // noop
      }
    }

    persistSession(null);
    if (!silent) {
      showStatus("Bạn đã đăng xuất khỏi Team Manager.", "info", false);
    }
  }

  function handleUnauthorized(message = "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.") {
    logout({ silent: true });
    openModal({
      reason: message,
      preserveCode: false
    });
  }

  async function withBusy(task) {
    state.busy = true;
    render();
    try {
      await task();
    } catch (error) {
      showStatus(error.message || "Không thể xử lý yêu cầu đăng nhập.", "danger", true);
    } finally {
      state.busy = false;
      render();
    }
  }

  function showStatus(message, type = "info", sticky = false) {
    const tone = {
      info: "status-banner--info",
      success: "status-banner--success",
      warning: "status-banner--warning",
      danger: "status-banner--danger"
    };

    els.statusBanner.className = `status-banner ${tone[type] || tone.info}`;
    els.statusBanner.textContent = message;
    els.statusBanner.classList.remove("is-hidden");

    if (state.statusTimer) {
      clearTimeout(state.statusTimer);
      state.statusTimer = null;
    }

    if (!sticky) {
      state.statusTimer = window.setTimeout(() => {
        els.statusBanner.classList.add("is-hidden");
      }, 3200);
    }
  }

  function hideStatus() {
    els.statusBanner.classList.add("is-hidden");
    if (state.statusTimer) {
      clearTimeout(state.statusTimer);
      state.statusTimer = null;
    }
  }

  function buildAuthHeaders(token = state.session?.authToken || "") {
    return token
      ? {
          "X-Community-Auth": token
        }
      : {};
  }

  function collectClientStats() {
    const teams = loadStoredTeams();
    const teamCount = teams.length;
    const memberCount = teams.reduce((total, team) => {
      const lastMemberCount = Number.parseInt(team?.lastMemberCount, 10);
      if (Number.isFinite(lastMemberCount) && lastMemberCount >= 0) {
        return total + lastMemberCount;
      }
      return total + (Array.isArray(team?.lastMembers) ? team.lastMembers.length : 0);
    }, 0);

    return {
      teamCount,
      memberCount,
      convertedLinkCount: readStoredNumber(GENERATED_LINK_COUNT_STORAGE_KEY)
    };
  }

  function loadStoredTeams() {
    try {
      const raw = JSON.parse(localStorage.getItem(TEAM_STORAGE_KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function readStoredNumber(key) {
    const value = Number.parseInt(localStorage.getItem(key) || "0", 10);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  }

  async function fetchJson(path, options = {}) {
    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });
    } catch (error) {
      const isFileOrigin = window.location.protocol === "file:";
      const defaultMessage = isFileOrigin
        ? "Web đang được mở trực tiếp từ file. Hãy chạy bằng http://localhost:3000 rồi thử lại."
        : "Không kết nối được tới server đăng nhập. Kiểm tra lại app đang chạy ở http://localhost:3000.";
      throw new Error(error?.message === "Failed to fetch" ? defaultMessage : (error?.message || defaultMessage));
    }

    const text = await response.text();
    const data = text ? safeJsonParse(text) : {};

    if (!response.ok) {
      throw new Error(data.error || data.message || `HTTP ${response.status}`);
    }

    return data;
  }

  function safeJsonParse(text) {
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "N/A";
    return date.toLocaleString("vi-VN");
  }
}

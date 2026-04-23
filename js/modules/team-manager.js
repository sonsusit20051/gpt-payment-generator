const PROXY = "";
const MAX_LIST_LIMIT = 100;
const AUTO_REFRESH_INTERVAL_MS = 60000;

export function mountTeamManager(root, auth = null) {
  if (!root) return null;

  const els = cacheElements(root);
  let teams = loadTeams();
  let currentTeamIndex = -1;
  let currentView = "dashboard";
  let activityTimer = null;
  let dashboardRefreshing = false;

  bindEvents();
  renderDashboard();
  renderTeamList();
  renderCurrentView();
  renderSelectionState();

  if (teams.length && auth?.isLoggedIn?.()) {
    refreshDashboard({ silent: true });
  }

  window.setInterval(() => {
    if (auth?.isLoggedIn?.()) {
      refreshDashboard({ silent: true });
    }
  }, AUTO_REFRESH_INTERVAL_MS);

  return {
    refreshDashboard,
    handleAuthChange
  };

  function cacheElements(scope) {
    return {
      tabDashboard: scope.querySelector("#tm-tab-dashboard"),
      tabManage: scope.querySelector("#tm-tab-manage"),
      banner: scope.querySelector("#tm-banner"),
      dashboardPanel: scope.querySelector("#tm-dashboard-panel"),
      managePanel: scope.querySelector("#tm-manage-panel"),
      dashboardGrid: scope.querySelector("#tm-dashboard-grid"),
      teamCountBadge: scope.querySelector("#tm-team-count-badge"),
      teamList: scope.querySelector("#tm-team-list"),
      emptyState: scope.querySelector("#tm-empty-state"),
      teamPanel: scope.querySelector("#tm-team-panel"),
      teamName: scope.querySelector("#tm-team-name"),
      teamStatusBadge: scope.querySelector("#tm-team-status-badge"),
      teamEmail: scope.querySelector("#tm-team-email"),
      teamAccountId: scope.querySelector("#tm-team-account-id"),
      teamMembersCount: scope.querySelector("#tm-team-members-count"),
      teamLastSync: scope.querySelector("#tm-team-last-sync"),
      membersMeta: scope.querySelector("#tm-members-meta"),
      autoKickToggle: scope.querySelector("#tm-auto-kick-toggle"),
      maxMembersInput: scope.querySelector("#tm-max-members-input"),
      autoKickSummary: scope.querySelector("#tm-auto-kick-summary"),
      membersArea: scope.querySelector("#tm-members-area"),
      openAddModalButton: scope.querySelector("#tm-open-add-modal"),
      addModal: scope.querySelector("#tm-add-modal"),
      inviteModal: scope.querySelector("#tm-invite-modal"),
      sessionJson: scope.querySelector("#tm-session-json"),
      newTeamName: scope.querySelector("#tm-new-team-name"),
      newTeamMaxMembers: scope.querySelector("#tm-new-team-max-members"),
      newTeamAutoKick: scope.querySelector("#tm-new-team-auto-kick"),
      addTeamButton: scope.querySelector("#tm-add-team-button"),
      refreshButton: scope.querySelector("#tm-refresh-button"),
      inviteButton: scope.querySelector("#tm-invite-button"),
      deleteTeamButton: scope.querySelector("#tm-delete-team-button"),
      inviteEmail: scope.querySelector("#tm-invite-email"),
      sendInviteButton: scope.querySelector("#tm-send-invite-button")
    };
  }

  function bindEvents() {
    els.tabDashboard.addEventListener("click", () => setView("dashboard"));
    els.tabManage.addEventListener("click", () => setView("manage"));
    els.openAddModalButton.addEventListener("click", showAddTeamModal);
    els.addTeamButton.addEventListener("click", addNewTeam);
    els.refreshButton.addEventListener("click", () => refreshSelectedTeam(true));
    els.inviteButton.addEventListener("click", showInviteModal);
    els.deleteTeamButton.addEventListener("click", deleteCurrentTeam);
    els.sendInviteButton.addEventListener("click", sendInvite);
    els.autoKickToggle.addEventListener("change", (event) => updateAutoKickEnabled(event.target.checked));
    els.maxMembersInput.addEventListener("change", (event) => updateMaxMembersSetting(event.target.value));

    root.querySelectorAll("[data-modal-close]").forEach((button) => {
      button.addEventListener("click", () => closeModal(button.dataset.modalClose));
    });
  }

  function setView(view) {
    currentView = view === "manage" ? "manage" : "dashboard";
    renderCurrentView();
    renderTeamList();
  }

  function renderCurrentView() {
    const isDashboard = currentView === "dashboard";
    els.dashboardPanel.classList.toggle("is-hidden", !isDashboard);
    els.managePanel.classList.toggle("is-hidden", isDashboard);
    els.tabDashboard.classList.toggle("is-active", isDashboard);
    els.tabManage.classList.toggle("is-active", !isDashboard);
  }

  function loadTeams() {
    const raw = JSON.parse(localStorage.getItem("teams") || "[]");
    return raw.map(normalizeTeam);
  }

  function normalizeTeam(team = {}) {
    const maxMembers = Number.parseInt(team.maxMembers, 10);
    const cachedMembers = Array.isArray(team.lastMembers) ? team.lastMembers : [];
    return {
      name: team.name || "",
      email: team.email || "",
      accessToken: team.accessToken || team.sessions?.accessToken || "",
      accountId: team.accountId || team.account?.id || "",
      maxMembers: Number.isFinite(maxMembers) && maxMembers > 0 ? maxMembers : 0,
      autoKickEnabled: Boolean(team.autoKickEnabled),
      lastMembers: cachedMembers,
      lastMemberCount: Number.isFinite(team.lastMemberCount) ? team.lastMemberCount : cachedMembers.length,
      lastStatus: team.lastStatus || "unknown",
      lastError: team.lastError || "",
      lastSyncedAt: team.lastSyncedAt || ""
    };
  }

  function saveTeams() {
    localStorage.setItem("teams", JSON.stringify(teams.map(normalizeTeam)));
  }

  function getCurrentTeam() {
    return currentTeamIndex >= 0 ? teams[currentTeamIndex] : null;
  }

  function getTeamDisplayName(team, index) {
    return team.name || `Team ${index + 1}`;
  }

  function formatDate(dateValue) {
    if (!dateValue) return "Chưa có";
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "Chưa có";
    return date.toLocaleString("vi-VN");
  }

  function formatCreatedTime(value) {
    if (!value) return "N/A";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "N/A";
    return date.toLocaleDateString("vi-VN");
  }

  function classifyStatusFromError(message) {
    const text = String(message || "").toLowerCase();
    if (text.includes("account_deactivated")) return "account_deactivated";
    if (text.includes("401") || text.includes("403") || text.includes("unauthorized") || text.includes("invalid")) {
      return "unauthorized";
    }
    return "error";
  }

  function getStatusMeta(status) {
    switch (status) {
      case "active":
        return {
          label: "active",
          badgeClass: "tm-status-active"
        };
      case "account_deactivated":
        return {
          label: "account_deactivated",
          badgeClass: "tm-status-deactivated"
        };
      case "unauthorized":
        return {
          label: "unauthorized",
          badgeClass: "tm-status-unauthorized"
        };
      case "error":
        return {
          label: "error",
          badgeClass: "tm-status-error"
        };
      default:
        return {
          label: "unknown",
          badgeClass: "tm-status-unknown"
        };
    }
  }

  function notify(message, type = "info", sticky = false) {
    const tone = {
      info: "status-banner--info",
      success: "status-banner--success",
      warning: "status-banner--warning",
      danger: "status-banner--danger"
    };

    els.banner.className = `status-banner ${tone[type] || tone.info}`;
    els.banner.textContent = message;
    els.banner.classList.remove("is-hidden");

    if (activityTimer) {
      clearTimeout(activityTimer);
      activityTimer = null;
    }

    if (!sticky) {
      activityTimer = window.setTimeout(() => {
        els.banner.classList.add("is-hidden");
      }, 4000);
    }
  }

  function hideNotification() {
    els.banner.classList.add("is-hidden");
    if (activityTimer) {
      clearTimeout(activityTimer);
      activityTimer = null;
    }
  }

  function requireLogin(reason) {
    if (!auth?.ensureAuthenticated) return true;
    return auth.ensureAuthenticated({ reason });
  }

  async function apiCall(team, path, method = "GET", body = null) {
    if (!team?.accessToken) throw new Error("Thiếu access token cho team này.");
    if (!team?.accountId) throw new Error("Thiếu accountId cho team này.");

    const authToken = auth?.getAuthToken?.();
    if (!authToken) {
      auth?.ensureAuthenticated?.({
        reason: "Đăng nhập Telegram để tiếp tục dùng Team Manager."
      });
      throw new Error("Bạn chưa đăng nhập Telegram.");
    }

    const url = `${PROXY}/api${path.startsWith("/") ? path : `/${path}`}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${team.accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Referer: "https://chatgpt.com/",
        "X-Community-Auth": authToken
      },
      body: body ? JSON.stringify(body) : undefined
    });

    const text = await response.text();
    if (response.status === 401) {
      auth?.handleUnauthorized?.("Phiên Telegram đã hết hạn. Vui lòng đăng nhập lại để quản lý team.");
      throw new Error("Phiên đăng nhập đã hết hạn.");
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} - ${text}`);
    }

    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  function renderDashboard() {
    const totalTeams = teams.length;
    const totalMembers = teams.reduce((sum, team) => sum + (team.lastMemberCount || 0), 0);
    const activeTeams = teams.filter((team) => team.lastStatus === "active").length;
    const deactivatedTeams = teams.filter((team) => team.lastStatus === "account_deactivated").length;

    const cards = [
      {
        label: "Total Teams",
        value: totalTeams,
        meta: `${activeTeams} active / ${deactivatedTeams} off`,
        className: "tm-dashboard-card tm-dashboard-card--wide"
      },
      {
        label: "Members",
        value: totalMembers,
        meta: "Mint block",
        className: "tm-dashboard-card tm-dashboard-card--mint"
      },
      {
        label: "Live",
        value: activeTeams,
        meta: "Border / white",
        className: "tm-dashboard-card tm-dashboard-card--plain"
      },
      {
        label: "Deactivated",
        value: deactivatedTeams,
        meta: "Purple rail",
        className: "tm-dashboard-card tm-dashboard-card--purple"
      }
    ];

    els.dashboardGrid.innerHTML = cards.map((card) => `
      <article class="${card.className}">
        <p class="label-mono tm-dashboard-card__label">${card.label}</p>
        <p class="tm-dashboard-card__value">${card.value}</p>
        <p class="tm-dashboard-card__meta">${card.meta}</p>
      </article>
    `).join("");

    els.teamCountBadge.textContent = `${totalTeams} team`;
  }

  function renderTeamList() {
    if (!teams.length) {
      els.teamList.innerHTML = `
        <div class="tm-empty-box">
          <p class="label-mono">No Teams</p>
          <p>Thêm team mới bằng session JSON để bắt đầu quản lý.</p>
        </div>
      `;
      return;
    }

    els.teamList.innerHTML = teams.map((team, index) => {
      const selected = index === currentTeamIndex;
      const status = getStatusMeta(team.lastStatus);
      const count = team.lastMemberCount || 0;
      return `
        <article
          class="tm-team-tile ${selected && currentView === "manage" ? "is-active" : ""}"
          data-team-index="${index}"
          role="button"
          tabindex="0"
        >
          <div class="tm-team-tile__rail">
            <p class="label-mono">T${index + 1}</p>
            <p class="label-mono">${team.lastSyncedAt ? formatDate(team.lastSyncedAt) : "No Sync"}</p>
          </div>
          <div class="tm-team-tile__body">
            <div class="tm-team-tile__title-row">
              <div>
                <p class="tm-team-tile__title">${escapeHtml(getTeamDisplayName(team, index))}</p>
                <p class="tm-team-tile__email">${escapeHtml(team.email || "Không có email")}</p>
              </div>
              <button type="button" class="secondary-action secondary-action--compact secondary-action--danger" data-delete-team="${index}">
                <i class="fas fa-trash"></i>
              </button>
            </div>
            <div class="tm-team-tile__meta">
              <span class="status-pill ${status.badgeClass}">${status.label}</span>
              <span class="sharp-badge tm-badge-inline">${count} member</span>
              ${team.autoKickEnabled ? '<span class="sharp-badge tm-badge-inline tm-badge-inline--mint">auto-kick</span>' : ""}
            </div>
          </div>
        </article>
      `;
    }).join("");

    els.teamList.querySelectorAll("[data-team-index]").forEach((tile) => {
      tile.addEventListener("click", () => selectTeam(Number(tile.dataset.teamIndex)));
      tile.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectTeam(Number(tile.dataset.teamIndex));
        }
      });
    });

    els.teamList.querySelectorAll("[data-delete-team]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteTeam(Number(button.dataset.deleteTeam));
      });
    });
  }

  function renderSelectionState() {
    const hasSelectedTeam = currentTeamIndex >= 0 && currentTeamIndex < teams.length;
    els.emptyState.classList.toggle("is-hidden", hasSelectedTeam);
    els.teamPanel.classList.toggle("is-hidden", !hasSelectedTeam);
    if (!hasSelectedTeam) hideNotification();
  }

  function renderSelectedTeam() {
    renderSelectionState();
    const team = getCurrentTeam();
    if (!team) return;

    const status = getStatusMeta(team.lastStatus);
    els.teamName.textContent = getTeamDisplayName(team, currentTeamIndex);
    els.teamEmail.textContent = team.email || "Không có email";
    els.teamAccountId.textContent = team.accountId || "Không có";
    els.teamMembersCount.textContent = String(team.lastMemberCount || 0);
    els.teamLastSync.textContent = formatDate(team.lastSyncedAt);
    els.membersMeta.textContent = `${team.lastMemberCount || 0} thành viên`;

    els.teamStatusBadge.className = `status-pill ${status.badgeClass}`;
    els.teamStatusBadge.textContent = status.label;

    els.maxMembersInput.value = team.maxMembers || 0;
    els.autoKickToggle.checked = team.autoKickEnabled;
    els.autoKickSummary.innerHTML = team.autoKickEnabled
      ? `AUTO-KICK ENABLED<br>MAX MEMBERS: <strong>${team.maxMembers || 0}</strong><br>LATEST MEMBER REMOVED WHEN LIMIT IS EXCEEDED.`
      : "AUTO-KICK DISABLED.";

    renderMembersArea(team);
  }

  function renderMembersLoading() {
    els.membersArea.innerHTML = `
      <div class="tm-loading-box">
        <span class="loading-strip"><span class="loading-strip__spinner"></span><span>Đang tải danh sách thành viên...</span></span>
      </div>
    `;
  }

  function isOwner(member) {
    return String(member?.role || "").includes("owner");
  }

  function renderMembersArea(team) {
    if (team.lastStatus !== "active" && team.lastError) {
      els.membersArea.innerHTML = `
        <div class="tm-error-box">
          Không thể tải danh sách thành viên cho team này.<br>
          <span>${escapeHtml(team.lastError)}</span>
        </div>
      `;
      return;
    }

    const members = Array.isArray(team.lastMembers) ? team.lastMembers : [];
    if (!members.length) {
      els.membersArea.innerHTML = `
        <div class="tm-empty-box">
          <p>Không có thành viên nào.</p>
        </div>
      `;
      return;
    }

    els.membersArea.innerHTML = `
      <div class="tm-members-list">
        ${members.map((member) => {
          const owner = isOwner(member);
          return `
            <div class="tm-member-row">
              <div class="tm-member-row__identity">
                <div class="tm-member-row__avatar">${(member.name || member.email || "?").slice(0, 1).toUpperCase()}</div>
                <div>
                  <p class="tm-member-row__name">${escapeHtml(member.name || "—")}</p>
                  <p class="tm-member-row__email">${escapeHtml(member.email || "—")}</p>
                </div>
              </div>
              <div class="tm-member-row__meta">
                <span class="label-mono tm-join-rail">Joined ${formatCreatedTime(member.created_time)}</span>
                <span class="status-pill tm-member-role ${owner ? "tm-member-role--owner tm-status-unauthorized" : "tm-member-role--member tm-status-error"}">${owner ? "owner" : "member"}</span>
                ${owner ? "" : `<button type="button" class="secondary-action secondary-action--compact secondary-action--danger" data-delete-member="${escapeHtml(member.id)}"><i class="fas fa-trash"></i></button>`}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;

    els.membersArea.querySelectorAll("[data-delete-member]").forEach((button) => {
      button.addEventListener("click", () => deleteMember(button.dataset.deleteMember));
    });
  }

  async function fetchMembersForTeam(index, options = {}) {
    const { showLoading = false, enforceAutoKick = false, showErrorBanner = true } = options;
    const team = teams[index];
    if (!team) return [];

    if (showLoading && index === currentTeamIndex) {
      renderMembersLoading();
    }

    try {
      const data = await apiCall(team, `/accounts/${team.accountId}/users?offset=0&limit=${MAX_LIST_LIMIT}&query=`);
      let items = Array.isArray(data.items) ? data.items : [];

      team.lastStatus = "active";
      team.lastError = "";
      team.lastMembers = items;
      team.lastMemberCount = Number.isFinite(data.total) ? data.total : items.length;
      team.lastSyncedAt = new Date().toISOString();
      saveTeams();

      if (enforceAutoKick) {
        items = await autoKickIfNeeded(index, items);
      }

      renderDashboard();
      renderTeamList();
      if (index === currentTeamIndex) renderSelectedTeam();
      return items;
    } catch (error) {
      team.lastStatus = classifyStatusFromError(error.message);
      team.lastError = error.message;
      team.lastMembers = [];
      team.lastMemberCount = 0;
      team.lastSyncedAt = new Date().toISOString();
      saveTeams();

      renderDashboard();
      renderTeamList();
      if (index === currentTeamIndex) renderSelectedTeam();
      if (showErrorBanner && !String(error.message || "").includes("hết hạn")) {
        notify(`Không thể tải team "${getTeamDisplayName(team, index)}": ${error.message}`, "danger");
      }
      return [];
    }
  }

  async function autoKickIfNeeded(index, members) {
    const team = teams[index];
    if (!team || !team.autoKickEnabled || !team.maxMembers || members.length <= team.maxMembers) {
      return members;
    }

    const overflow = members.length - team.maxMembers;
    const removable = [...members]
      .filter((member) => !isOwner(member))
      .sort((a, b) => new Date(b.created_time || 0).getTime() - new Date(a.created_time || 0).getTime());

    if (!removable.length) {
      notify(`Team "${getTeamDisplayName(team, index)}" vượt giới hạn nhưng không có member nào có thể auto-kick.`, "warning");
      return members;
    }

    const kickedMembers = removable.slice(0, overflow);
    for (const member of kickedMembers) {
      await apiCall(team, `/accounts/${team.accountId}/users/${member.id}`, "DELETE");
    }

    const refreshed = await apiCall(team, `/accounts/${team.accountId}/users?offset=0&limit=${MAX_LIST_LIMIT}&query=`);
    const items = Array.isArray(refreshed.items) ? refreshed.items : [];
    team.lastMembers = items;
    team.lastMemberCount = Number.isFinite(refreshed.total) ? refreshed.total : items.length;
    team.lastStatus = "active";
    team.lastError = "";
    team.lastSyncedAt = new Date().toISOString();
    saveTeams();

    const names = kickedMembers.map((member) => member.email || member.name || member.id).join(", ");
    notify(`Auto-kick đã xóa ${kickedMembers.length} member mới nhất khỏi "${getTeamDisplayName(team, index)}": ${names}`, "warning");
    return items;
  }

  async function selectTeam(index) {
    currentTeamIndex = index;
    currentView = "manage";
    renderCurrentView();
    renderTeamList();
    renderSelectedTeam();

    if (!auth?.isLoggedIn?.()) {
      return;
    }

    await fetchMembersForTeam(index, { showLoading: true, enforceAutoKick: true, showErrorBanner: true });
  }

  async function refreshSelectedTeam(showBanner = false) {
    if (currentTeamIndex < 0) return;
    if (!requireLogin("Đăng nhập Telegram trước khi đồng bộ team.")) return;

    await fetchMembersForTeam(currentTeamIndex, { showLoading: true, enforceAutoKick: true, showErrorBanner: true });
    if (showBanner && teams[currentTeamIndex]?.lastStatus === "active") {
      notify(`Đã cập nhật team "${getTeamDisplayName(teams[currentTeamIndex], currentTeamIndex)}".`, "success");
    }
  }

  async function refreshDashboard(options = {}) {
    const { silent = false } = options;
    if (dashboardRefreshing || !teams.length || !auth?.isLoggedIn?.()) return;

    dashboardRefreshing = true;
    renderDashboard();
    if (!silent) {
      notify("Đang đồng bộ dashboard cho tất cả team...", "info", true);
    }

    for (let index = 0; index < teams.length; index += 1) {
      await fetchMembersForTeam(index, {
        showLoading: index === currentTeamIndex,
        enforceAutoKick: teams[index]?.autoKickEnabled,
        showErrorBanner: false
      });
    }

    dashboardRefreshing = false;
    renderDashboard();
    if (!silent) {
      notify("Đã đồng bộ dashboard cho toàn bộ team.", "success");
    }
  }

  function handleAuthChange(session) {
    if (session && teams.length) {
      refreshDashboard({ silent: true });
    }
  }

  function showAddTeamModal() {
    els.addModal.classList.remove("is-hidden");
  }

  function hideAddTeamModal() {
    els.addModal.classList.add("is-hidden");
  }

  async function addNewTeam() {
    const jsonStr = els.sessionJson.value.trim();
    const manualName = els.newTeamName.value.trim();
    const maxMembersValue = Number.parseInt(els.newTeamMaxMembers.value, 10);
    const autoKickEnabled = els.newTeamAutoKick.checked;

    if (!jsonStr) {
      notify("Dán session JSON trước khi thêm team.", "warning");
      return;
    }

    if (!requireLogin("Đăng nhập Telegram trước khi thêm team mới.")) {
      return;
    }

    try {
      const session = JSON.parse(jsonStr);
      const accountId = session.account?.id || session.accountId;
      const accessToken = session.accessToken || session.sessions?.accessToken;

      if (!accountId || !accessToken) {
        throw new Error("Session JSON thiếu accountId hoặc accessToken.");
      }

      const existingIndex = teams.findIndex((team) => team.accountId === accountId);
      if (existingIndex >= 0) {
        notify("Team này đã tồn tại trong danh sách quản lý.", "warning");
        currentTeamIndex = existingIndex;
        renderTeamList();
        renderSelectedTeam();
        hideAddTeamModal();
        await selectTeam(existingIndex);
        return;
      }

      const team = normalizeTeam({
        name: manualName || session.account?.name || session.user?.name || accountId.slice(0, 8),
        email: session.user?.email || session.email || "",
        accessToken,
        accountId,
        maxMembers: Number.isFinite(maxMembersValue) && maxMembersValue > 0 ? maxMembersValue : 0,
        autoKickEnabled
      });

      teams.push(team);
      saveTeams();
      hideAddTeamModal();
      els.sessionJson.value = "";
      els.newTeamName.value = "";
      els.newTeamMaxMembers.value = 0;
      els.newTeamAutoKick.checked = false;
      renderDashboard();
      renderTeamList();
      notify(`Đã thêm team "${getTeamDisplayName(team, teams.length - 1)}".`, "success");
      await selectTeam(teams.length - 1);
    } catch (error) {
      notify(`Không thể thêm team: ${error.message || "Session JSON không hợp lệ."}`, "danger");
    }
  }

  function showInviteModal() {
    if (currentTeamIndex < 0) {
      notify("Chọn team trước khi gửi lời mời.", "warning");
      return;
    }
    if (!requireLogin("Đăng nhập Telegram trước khi mời thành viên.")) return;

    els.inviteEmail.value = "";
    els.inviteModal.classList.remove("is-hidden");
  }

  function hideInviteModal() {
    els.inviteModal.classList.add("is-hidden");
    els.inviteEmail.value = "";
  }

  async function sendInvite() {
    const team = getCurrentTeam();
    const email = els.inviteEmail.value.trim();

    if (!team) {
      notify("Chưa chọn team.", "warning");
      return;
    }
    if (!email) {
      notify("Nhập email trước khi gửi lời mời.", "warning");
      return;
    }
    if (!requireLogin("Đăng nhập Telegram trước khi gửi lời mời.")) return;

    try {
      await apiCall(team, `/accounts/${team.accountId}/invites`, "POST", {
        email_addresses: [email],
        role: "standard-user",
        seat_type: "default",
        resend_emails: true
      });
      hideInviteModal();
      notify(`Đã gửi lời mời tới ${email}.`, "success");
      await refreshSelectedTeam(false);
    } catch (error) {
      notify(`Lỗi invite: ${error.message}`, "danger");
    }
  }

  async function deleteMember(userId) {
    const team = getCurrentTeam();
    if (!team) return;
    if (!requireLogin("Đăng nhập Telegram trước khi xóa member.")) return;
    if (!window.confirm("Xóa thành viên này khỏi team?")) return;

    try {
      await apiCall(team, `/accounts/${team.accountId}/users/${userId}`, "DELETE");
      notify("Đã xóa thành viên thành công.", "success");
      await refreshSelectedTeam(false);
    } catch (error) {
      notify(`Lỗi xóa member: ${error.message}`, "danger");
    }
  }

  async function deleteCurrentTeam() {
    if (currentTeamIndex < 0) return;
    await deleteTeam(currentTeamIndex);
  }

  async function deleteTeam(index) {
    const team = teams[index];
    if (!team) return;
    if (!requireLogin("Đăng nhập Telegram trước khi chỉnh sửa danh sách team.")) return;
    if (!window.confirm(`Xóa "${getTeamDisplayName(team, index)}" khỏi danh sách quản lý?`)) return;

    teams.splice(index, 1);

    if (!teams.length) {
      currentTeamIndex = -1;
    } else if (currentTeamIndex === index) {
      currentTeamIndex = Math.min(index, teams.length - 1);
    } else if (currentTeamIndex > index) {
      currentTeamIndex -= 1;
    }

    saveTeams();
    renderDashboard();
    renderTeamList();
    renderSelectedTeam();
    notify("Đã xóa team khỏi danh sách quản lý.", "success");

    if (currentTeamIndex >= 0 && auth?.isLoggedIn?.()) {
      await fetchMembersForTeam(currentTeamIndex, { showLoading: true, enforceAutoKick: true, showErrorBanner: false });
    }
  }

  function updateAutoKickEnabled(enabled) {
    const team = getCurrentTeam();
    if (!team) return;
    if (!requireLogin("Đăng nhập Telegram trước khi đổi cấu hình auto-kick.")) {
      els.autoKickToggle.checked = team.autoKickEnabled;
      return;
    }

    team.autoKickEnabled = Boolean(enabled);
    saveTeams();
    renderDashboard();
    renderTeamList();
    renderSelectedTeam();

    if (team.autoKickEnabled && team.maxMembers > 0 && team.lastMembers.length > team.maxMembers) {
      refreshSelectedTeam(false);
    }
  }

  function updateMaxMembersSetting(value) {
    const team = getCurrentTeam();
    if (!team) return;
    if (!requireLogin("Đăng nhập Telegram trước khi đổi giới hạn member.")) {
      els.maxMembersInput.value = team.maxMembers || 0;
      return;
    }

    const parsed = Number.parseInt(value, 10);
    team.maxMembers = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    saveTeams();
    renderDashboard();
    renderTeamList();
    renderSelectedTeam();

    if (team.autoKickEnabled && team.maxMembers > 0 && team.lastMembers.length > team.maxMembers) {
      refreshSelectedTeam(false);
    }
  }

  function closeModal(modalId) {
    if (modalId === "tm-add-modal") {
      hideAddTeamModal();
    } else if (modalId === "tm-invite-modal") {
      hideInviteModal();
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

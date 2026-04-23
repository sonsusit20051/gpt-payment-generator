import { mountTelegramAuth } from "./modules/auth.js";
import { mountCheckoutGenerator } from "./modules/checkout-generator.js";
import { mountTeamManager } from "./modules/team-manager.js";

document.addEventListener("DOMContentLoaded", () => {
  const navButtons = Array.from(document.querySelectorAll("[data-community-view]"));
  const panels = Array.from(document.querySelectorAll("[data-community-panel]"));

  const auth = mountTelegramAuth();
  const checkout = mountCheckoutGenerator(document.getElementById("checkout-generator-module"));
  const teamManager = mountTeamManager(document.getElementById("team-manager-module"), auth);

  const viewMeta = {
    home: {
      title: "M MOI Community"
    },
    "checkout-generator": {
      title: "Checkout Generator"
    },
    "team-manager": {
      title: "Team Manager"
    }
  };

  function setView(view) {
    navButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.communityView === view);
    });
    panels.forEach((panel) => {
      panel.classList.toggle("is-hidden", panel.dataset.communityPanel !== view);
    });

    const meta = viewMeta[view];
    if (meta) {
      document.title = `${meta.title} | M MOI Community`;
    }

    localStorage.setItem("communityView", view);
  }

  navButtons.forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.communityView));
  });

  const savedView = localStorage.getItem("communityView");
  setView(savedView && viewMeta[savedView] ? savedView : "home");

  auth?.onChange((session) => {
    teamManager?.handleAuthChange?.(session);
  });

  window.mMoiCommunity = {
    auth,
    checkout,
    teamManager
  };
});

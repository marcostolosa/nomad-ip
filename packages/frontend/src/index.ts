import { Classic } from "@caido/primevue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import { createApp } from "vue";

import { SDKPlugin } from "./plugins/sdk";
import "./styles/index.css";
import type { FrontendSDK } from "./types";
import App from "./views/App.vue";

// This is the entry point for the frontend plugin
export const init = (sdk: FrontendSDK) => {
  const app = createApp(App);

  // Load Pinia for state management
  const pinia = createPinia();
  app.use(pinia);

  // Load the PrimeVue component library
  app.use(PrimeVue, {
    unstyled: true,
    pt: Classic,
  });

  // Provide the FrontendSDK
  app.use(SDKPlugin, sdk);

  // Create the root element for the app
  const root = document.createElement("div");
  Object.assign(root.style, {
    height: "100%",
    width: "100%",
  });

  root.id = `plugin--nomad-ip`;

  app.mount(root);

  sdk.navigation.addPage("/nomad-ip", {
    body: root,
  });

  sdk.sidebar.registerItem("Nomad IP", "/nomad-ip", {
    icon: "fas fa-sync-alt",
  });
};

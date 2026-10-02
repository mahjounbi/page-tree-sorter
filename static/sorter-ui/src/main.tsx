import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { requestConfluence, router, view } from "@forge/bridge";
import "@atlaskit/css-reset";
import "./styles.css";
import { App } from "./App";
import { languageOf } from "./i18n";
import type { ConfluenceRequest } from "../../../src/core/http";
import { normalizeLocale } from "../../../src/core/sort";

// Calls run in the browser with the current user's Confluence permissions (CA7).
const request: ConfluenceRequest = (path, init) => requestConfluence(path, init) as Promise<Response>;

// Paid licensing: Atlassian sets context.license on production installs only
// (absent in development). Without an active licence or trial, show why.
function Unlicensed({ lang }: { lang: "en" | "fr" }) {
  return (
    <p style={{ padding: 24 }}>
      {lang === "fr"
        ? "La licence de cette app n'est pas active. Un administrateur peut démarrer l'essai gratuit ou s'abonner depuis Gérer les apps."
        : "This app's licence is not active. An admin can start the free trial or subscribe from Manage apps."}
    </p>
  );
}

async function start() {
  await view.theme.enable();
  const context = await view.getContext();
  const content = (context.extension as { content?: { id?: string | number; title?: string } }).content;
  const lang = languageOf(context.locale ?? navigator.language);
  if (context.license && !context.license.active) {
    createRoot(document.getElementById("root")!).render(<Unlicensed lang={lang} />);
    return;
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App
        request={request}
        pageId={String(content?.id ?? "")}
        pageTitle={content?.title}
        locale={normalizeLocale(context.locale ?? navigator.language)}
        lang={lang}
        // The Confluence sidebar does not follow moves made by the app: reload
        // the page so it shows the new order.
        onClose={(changed) => void (changed ? router.reload() : view.close())}
      />
    </StrictMode>,
  );
}

void start();

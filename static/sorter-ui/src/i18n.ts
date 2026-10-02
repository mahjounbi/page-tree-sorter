import type { SortOrder } from "../../../src/core/sort";

// UI text in English and French, picked from the Confluence user's locale.
// Kept in code (not Forge translation files) so the mock site shows it too.

const count = (n: number, lang: Lang) => n.toLocaleString(lang === "fr" ? "fr-FR" : "en-US");

const en = {
  orders: { "title-asc": "Title, A to Z", "title-desc": "Title, Z to A", "created-desc": "Newest first", "created-asc": "Oldest first" } as Record<SortOrder, string>,
  types: { folder: "Folder", whiteboard: "Whiteboard", database: "Database", embed: "Smart link" } as Record<string, string>,
  heading: "Sort child pages",
  under: (title: string) => `Under “${title}”`,
  loading: "Loading child pages",
  errorTitle: "The pages could not be sorted",
  tryAgain: "Try again",
  sortingAria: "Sorting pages",
  moving: (done: number, total: number) => `Moving ${count(done, "en")} of ${pages(total, "en")}…`,
  restoredTitle: "Previous order restored",
  restoredText: "The pages are back in the order they had before sorting. Automatic sorting is off.",
  movedTitle: (n: number) => `${pages(n, "en")} moved`,
  saved: "Saved",
  restore: "Restore previous order",
  allInOrder: (n: number) => `All ${count(n, "en")} child ${n === 1 ? "page" : "pages"} are now in order.`,
  ruleOn: "Automatic sorting is on.",
  ruleOff: "Automatic sorting is off.",
  staySorted: " They will stay sorted automatically.",
  stoppedTitle: "Sorting stopped",
  alreadyMoved: (n: number) => `${pages(n, "en")} had already moved. The preview shows the current order.`,
  noneMoved: "No page was moved.",
  stillOn: (order: string) => ` Automatic sorting (${order}) is still on: the next page change puts them back in that order.`,
  noChildren: "This page has no child pages",
  oneChild: "There is only one child page",
  addChildren: "Add child pages, then come back to sort them.",
  order: "Order",
  naturalHint: "Titles are sorted naturally: “Page 2” comes before “Page 10”.",
  ruleOnWith: (order: string) => `Automatic sorting is on: ${order}.`,
  keep: "Keep sorted automatically",
  keepHint: "New, moved or renamed child pages are put back in order.",
  preview: "Preview",
  readingDates: "Reading creation dates…",
  alreadyInOrder: (n: number) => `${pages(n, "en")}, already in this order`,
  willMove: (n: number, moves: number) => `${pages(n, "en")}, ${count(moves, "en")} will move`,
  newOrder: "New order",
  untitled: "Untitled",
  moves: "Moves",
  cancel: "Cancel",
  close: "Close",
  sortPages: "Sort pages",
  turnOff: "Turn off automatic sorting",
  update: "Update automatic sorting",
  turnOn: "Turn on automatic sorting",
};

export type Messages = typeof en;
export type Lang = "en" | "fr";

const fr: Messages = {
  orders: { "title-asc": "Titre, de A à Z", "title-desc": "Titre, de Z à A", "created-desc": "Plus récentes d’abord", "created-asc": "Plus anciennes d’abord" },
  types: { folder: "Dossier", whiteboard: "Tableau blanc", database: "Base de données", embed: "Lien intelligent" },
  heading: "Trier les sous-pages",
  under: (title) => `Sous « ${title} »`,
  loading: "Chargement des sous-pages",
  errorTitle: "Les pages n’ont pas pu être triées",
  tryAgain: "Réessayer",
  sortingAria: "Tri des pages",
  moving: (done, total) => `Déplacement de ${count(done, "fr")} sur ${pages(total, "fr")}…`,
  restoredTitle: "Ordre précédent rétabli",
  restoredText: "Les pages ont retrouvé l’ordre qu’elles avaient avant le tri. Le tri automatique est désactivé.",
  movedTitle: (n) => `${pages(n, "fr")} ${n === 1 ? "déplacée" : "déplacées"}`,
  saved: "Enregistré",
  restore: "Rétablir l’ordre précédent",
  allInOrder: (n) => n === 1 ? "La sous-page est maintenant dans l’ordre." : `Les ${count(n, "fr")} sous-pages sont maintenant dans l’ordre.`,
  ruleOn: "Le tri automatique est activé.",
  ruleOff: "Le tri automatique est désactivé.",
  staySorted: " Elles resteront triées automatiquement.",
  stoppedTitle: "Tri arrêté",
  alreadyMoved: (n) => `${pages(n, "fr")} ${n === 1 ? "avait" : "avaient"} déjà été ${n === 1 ? "déplacée" : "déplacées"}. L’aperçu montre l’ordre actuel.`,
  noneMoved: "Aucune page n’a été déplacée.",
  stillOn: (order) => ` Le tri automatique (${order}) reste activé : la prochaine modification de page les remettra dans cet ordre.`,
  noChildren: "Cette page n’a pas de sous-pages",
  oneChild: "Il n’y a qu’une seule sous-page",
  addChildren: "Ajoutez des sous-pages, puis revenez pour les trier.",
  order: "Ordre",
  naturalHint: "Les titres sont triés naturellement : « Page 2 » vient avant « Page 10 ».",
  ruleOnWith: (order) => `Tri automatique activé : ${order}.`,
  keep: "Garder trié automatiquement",
  keepHint: "Les sous-pages créées, déplacées ou renommées sont remises dans l’ordre.",
  preview: "Aperçu",
  readingDates: "Lecture des dates de création…",
  alreadyInOrder: (n) => `${pages(n, "fr")}, déjà dans cet ordre`,
  willMove: (n, moves) => `${pages(n, "fr")}, ${count(moves, "fr")} ${moves === 1 ? "sera déplacée" : "seront déplacées"}`,
  newOrder: "Nouvel ordre",
  untitled: "Sans titre",
  moves: "À déplacer",
  cancel: "Annuler",
  close: "Fermer",
  sortPages: "Trier les pages",
  turnOff: "Désactiver le tri automatique",
  update: "Mettre à jour le tri automatique",
  turnOn: "Activer le tri automatique",
};

function pages(n: number, lang: Lang): string {
  return `${count(n, lang)} ${n === 1 ? "page" : "pages"}`;
}

export function languageOf(locale: string | undefined): Lang {
  return locale?.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export const MESSAGES: Record<Lang, Messages> = { en, fr };

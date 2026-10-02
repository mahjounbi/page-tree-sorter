import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Button from "@atlaskit/button/new";
import Heading from "@atlaskit/heading";
import Lozenge from "@atlaskit/lozenge";
import { Checkbox } from "@atlaskit/checkbox";
import ProgressBar from "@atlaskit/progress-bar";
import { RadioGroup } from "@atlaskit/radio";
import SectionMessage, { SectionMessageAction } from "@atlaskit/section-message";
import Spinner from "@atlaskit/spinner";
import { applyPlan, deleteRule, getRule, listChildren, sortAndSetRule, withCreatedDates } from "../../../src/core/confluence";
import { ConfluenceError, SortCancelled, type ConfluenceRequest } from "../../../src/core/http";
import { needsDates, planMoves, sortChildren, type Child, type SortOrder } from "../../../src/core/sort";

const ORDER_LABELS: Record<SortOrder, string> = {
  "title-asc": "Title, A to Z",
  "title-desc": "Title, Z to A",
  "created-desc": "Newest first",
  "created-asc": "Oldest first",
};

const ORDER_OPTIONS = (Object.keys(ORDER_LABELS) as SortOrder[]).map((value) => ({ name: "order", value, label: ORDER_LABELS[value] }));

const TYPE_LABELS: Record<string, string> = { folder: "Folder", whiteboard: "Whiteboard", database: "Database", embed: "Smart link" };

type Phase =
  | { name: "loading" }
  | { name: "ready" }
  | { name: "sorting"; done: number; total: number }
  | { name: "done"; total: number; moved: number; keep: boolean; previous: string[] | null; restored: boolean }
  | { name: "stopped"; moved: number }
  | { name: "error"; message: string; retryable: boolean };

type Props = {
  request: ConfluenceRequest;
  pageId: string;
  pageTitle?: string;
  locale: string;
  onClose: () => void;
};

function errorPhase(error: unknown): Phase {
  const status = error instanceof ConfluenceError ? error.status : 0;
  return { name: "error", message: (error as Error).message, retryable: status !== 401 && status !== 403 };
}

const plural = (count: number, word: string) => `${count.toLocaleString("en")} ${word}${count === 1 ? "" : "s"}`;

export function App({ request, pageId, pageTitle, locale, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [children, setChildren] = useState<Child[]>([]);
  const [datesLoaded, setDatesLoaded] = useState(false);
  const [order, setOrder] = useState<SortOrder>("title-asc");
  const [savedRule, setSavedRule] = useState<SortOrder | null>(null);
  const [keep, setKeep] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    setPhase({ name: "loading" });
    try {
      const [items, rule] = await Promise.all([listChildren(request, pageId), getRule(request, pageId)]);
      const initialOrder = rule?.order ?? "title-asc";
      setChildren(needsDates(initialOrder) ? await withCreatedDates(request, items) : items);
      setDatesLoaded(needsDates(initialOrder));
      setOrder(initialOrder);
      setSavedRule(rule?.order ?? null);
      setKeep(rule !== null);
      setPhase({ name: "ready" });
    } catch (error) {
      setPhase(errorPhase(error));
    }
  }, [request, pageId]);

  // After a cancel, some pages have already moved: re-read the real order but
  // keep the user's choices.
  async function reloadChildren() {
    setPhase({ name: "loading" });
    try {
      const items = await listChildren(request, pageId);
      setChildren(needsDates(order) ? await withCreatedDates(request, items) : items);
      setDatesLoaded(needsDates(order));
      setPhase({ name: "ready" });
    } catch (error) {
      setPhase(errorPhase(error));
    }
  }

  useEffect(() => { void load(); }, [load]);

  async function chooseOrder(next: SortOrder) {
    setOrder(next);
    if (needsDates(next) && !datesLoaded) {
      try {
        setChildren(await withCreatedDates(request, children));
        setDatesLoaded(true);
      } catch (error) {
        setPhase(errorPhase(error));
      }
    }
  }

  const waitingForDates = needsDates(order) && !datesLoaded;
  const sorted = useMemo(() => (waitingForDates ? children : sortChildren(children, order, locale)), [children, order, locale, waitingForDates]);
  const moves = useMemo(() => planMoves(children.map((child) => child.id), sorted.map((child) => child.id)), [children, sorted]);
  const movingIds = useMemo(() => new Set(moves.map((move) => move.id)), [moves]);
  const ruleChanged = keep ? savedRule !== order : savedRule !== null;
  const nothingToDo = moves.length === 0 && !ruleChanged;

  async function apply() {
    const run = new AbortController();
    controller.current = run;
    const previous = children.map((child) => child.id);
    let moved = 0;
    setPhase({ name: "sorting", done: 0, total: moves.length });
    try {
      moved = await sortAndSetRule(request, pageId, moves, {
        previous: savedRule === null ? null : { order: savedRule, locale },
        next: keep ? { order, locale } : null,
      }, {
        signal: run.signal,
        onProgress: (done) => { moved = done; setPhase({ name: "sorting", done, total: moves.length }); },
      });
      setChildren(sorted);
      setSavedRule(keep ? order : null);
      setPhase({ name: "done", total: children.length, moved, keep, previous: moved > 0 ? previous : null, restored: false });
    } catch (error) {
      if (error instanceof SortCancelled) {
        await reloadChildren();
        setPhase({ name: "stopped", moved });
        return;
      }
      setPhase(errorPhase(error));
    } finally {
      controller.current = null;
    }
  }

  // Puts the pages back in the order they had before the last sort. An active
  // keep-sorted rule would undo this, so it is turned off first.
  async function restore(previous: string[]) {
    const byId = new Map(children.map((child) => [child.id, child]));
    const back = previous.filter((id) => byId.has(id));
    const current = children.map((child) => child.id).filter((id) => back.includes(id));
    const plan = planMoves(current, back);
    setPhase({ name: "sorting", done: 0, total: plan.length });
    try {
      if (savedRule !== null) await deleteRule(request, pageId);
      await applyPlan(request, plan, { onProgress: (done) => setPhase({ name: "sorting", done, total: plan.length }) });
      setSavedRule(null);
      setKeep(false);
      setChildren(back.map((id) => byId.get(id)!));
      setPhase({ name: "done", total: back.length, moved: plan.length, keep: false, previous: null, restored: true });
    } catch (error) {
      setPhase(errorPhase(error));
    }
  }

  const busy = phase.name === "sorting";
  // Close is the main button whenever there is nothing else to do.
  const canSort = (phase.name === "ready" || phase.name === "stopped") && children.length >= 2;

  return (
    <main className="sorter">
      <header>
        <Heading size="large" as="h1">Sort child pages</Heading>
        {pageTitle ? <p className="subtle">Under “{pageTitle}”</p> : null}
      </header>

      <div className="body">
      {phase.name === "loading" ? (
        <div className="center" role="status"><Spinner label="Loading child pages" /></div>
      ) : null}

      {phase.name === "error" ? (
        <SectionMessage appearance="error" title="The pages could not be sorted" actions={phase.retryable ? <SectionMessageAction onClick={() => void load()}>Try again</SectionMessageAction> : undefined}>
          <p>{phase.message}</p>
        </SectionMessage>
      ) : null}

      {phase.name === "sorting" ? (
        <div className="status" role="status">
          <ProgressBar ariaLabel="Sorting pages" value={phase.total ? phase.done / phase.total : 1} />
          <p className="subtle">{`Moving ${phase.done.toLocaleString("en")} of ${plural(phase.total, "page")}…`}</p>
        </div>
      ) : null}

      {phase.name === "done" ? (
        <div className="status">
          {phase.restored ? (
            <SectionMessage appearance="information" title="Previous order restored">
              <p>The pages are back in the order they had before sorting. Automatic sorting is off.</p>
            </SectionMessage>
          ) : (
            <SectionMessage
              appearance="success"
              title={phase.moved ? `${plural(phase.moved, "page")} moved` : "Saved"}
              actions={phase.previous ? <SectionMessageAction onClick={() => void restore(phase.previous!)}>Restore previous order</SectionMessageAction> : undefined}
            >
              <p>
                {phase.moved ? `All ${plural(phase.total, "child page")} are now in order.` : phase.keep ? "Automatic sorting is on." : "Automatic sorting is off."}
                {phase.moved && phase.keep ? " They will stay sorted automatically." : ""}
              </p>
            </SectionMessage>
          )}
        </div>
      ) : null}

      {phase.name === "stopped" ? (
        <div className="status">
          <SectionMessage appearance="information" title="Sorting stopped">
            <p>
              {phase.moved ? `${plural(phase.moved, "page")} had already moved. The preview shows the current order.` : "No page was moved."}
              {phase.moved && savedRule !== null ? ` Automatic sorting (${ORDER_LABELS[savedRule]}) is still on: the next page change puts them back in that order.` : ""}
            </p>
          </SectionMessage>
        </div>
      ) : null}

      {phase.name !== "loading" && phase.name !== "error" && children.length < 2 ? (
        <SectionMessage appearance="information" title={children.length === 0 ? "This page has no child pages" : "There is only one child page"}>
          <p>Add child pages, then come back to sort them.</p>
        </SectionMessage>
      ) : null}

      {phase.name !== "loading" && phase.name !== "error" && children.length >= 2 ? (
        <div className="layout">
          <section aria-labelledby="order-heading">
            <Heading size="small" as="h2" id="order-heading">Order</Heading>
            <RadioGroup
              options={ORDER_OPTIONS}
              value={order}
              isDisabled={busy}
              onChange={(event) => void chooseOrder(event.currentTarget.value as SortOrder)}
              aria-labelledby="order-heading"
            />
            <p className="hint">Titles are sorted naturally: “Page 2” comes before “Page 10”.</p>

            <div className="keep">
              {savedRule !== null ? (
                <p className="rule-on">{`Automatic sorting is on: ${ORDER_LABELS[savedRule]}.`}</p>
              ) : null}
              <Checkbox
                isChecked={keep}
                isDisabled={busy}
                onChange={(event) => setKeep(event.currentTarget.checked)}
                label="Keep sorted automatically"
                name="keep"
              />
              <p className="hint">New, moved or renamed child pages are put back in order.</p>
            </div>
          </section>

          <section aria-labelledby="preview-heading">
            <Heading size="small" as="h2" id="preview-heading">Preview</Heading>
            <p className="subtle" aria-live="polite">
              {waitingForDates
                ? "Reading creation dates…"
                : moves.length === 0
                  ? `${plural(children.length, "page")}, already in this order`
                  : `${plural(children.length, "page")}, ${moves.length.toLocaleString("en")} will move`}
            </p>
            <ol className="preview" tabIndex={0} aria-label="New order">
              {sorted.map((child) => (
                <li key={child.id} className={movingIds.has(child.id) ? "moving" : undefined}>
                  <span className="title">{child.title || "Untitled"}</span>
                  {TYPE_LABELS[child.type] ? <span className="type">{TYPE_LABELS[child.type]}</span> : null}
                  {movingIds.has(child.id) ? <Lozenge appearance="moved">Moves</Lozenge> : null}
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}

      </div>

      <footer>
        {busy ? (
          <Button onClick={() => controller.current?.abort()}>Cancel</Button>
        ) : (
          <>
            <Button appearance={canSort ? "subtle" : "primary"} onClick={onClose}>Close</Button>
            {canSort ? (
              <Button appearance="primary" isDisabled={nothingToDo || waitingForDates} onClick={() => void apply()}>
                {moves.length > 0 || !ruleChanged ? "Sort pages" : !keep ? "Turn off automatic sorting" : savedRule !== null ? "Update automatic sorting" : "Turn on automatic sorting"}
              </Button>
            ) : null}
          </>
        )}
      </footer>
    </main>
  );
}

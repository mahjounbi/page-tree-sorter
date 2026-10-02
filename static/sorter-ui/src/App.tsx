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
import { MESSAGES, type Lang } from "./i18n";

const ORDERS: SortOrder[] = ["title-asc", "title-desc", "created-desc", "created-asc"];

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
  lang: Lang;
  // `changed` is true when pages moved, so the host page can refresh its sidebar.
  onClose: (changed: boolean) => void;
};

function errorPhase(error: unknown): Phase {
  const status = error instanceof ConfluenceError ? error.status : 0;
  return { name: "error", message: (error as Error).message, retryable: status !== 401 && status !== 403 };
}

export function App({ request, pageId, pageTitle, locale, lang, onClose }: Props) {
  const m = MESSAGES[lang];
  const orderOptions = ORDERS.map((value) => ({ name: "order", value, label: m.orders[value] }));
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [children, setChildren] = useState<Child[]>([]);
  const [datesLoaded, setDatesLoaded] = useState(false);
  const [order, setOrder] = useState<SortOrder>("title-asc");
  const [savedRule, setSavedRule] = useState<SortOrder | null>(null);
  const [keep, setKeep] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const changed = useRef(false);

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
      if (moved > 0) changed.current = true;
      setChildren(sorted);
      setSavedRule(keep ? order : null);
      setPhase({ name: "done", total: children.length, moved, keep, previous: moved > 0 ? previous : null, restored: false });
    } catch (error) {
      if (error instanceof SortCancelled) {
        if (moved > 0) changed.current = true;
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
      if (plan.length > 0) changed.current = true;
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
        <Heading size="large" as="h1">{m.heading}</Heading>
        {pageTitle ? <p className="subtle">{m.under(pageTitle)}</p> : null}
      </header>

      <div className="body">
      {phase.name === "loading" ? (
        <div className="center" role="status"><Spinner label={m.loading} /></div>
      ) : null}

      {phase.name === "error" ? (
        <SectionMessage appearance="error" title={m.errorTitle} actions={phase.retryable ? <SectionMessageAction onClick={() => void load()}>{m.tryAgain}</SectionMessageAction> : undefined}>
          <p>{phase.message}</p>
        </SectionMessage>
      ) : null}

      {phase.name === "sorting" ? (
        <div className="status" role="status">
          <ProgressBar ariaLabel={m.sortingAria} value={phase.total ? phase.done / phase.total : 1} />
          <p className="subtle">{m.moving(phase.done, phase.total)}</p>
        </div>
      ) : null}

      {phase.name === "done" ? (
        <div className="status">
          {phase.restored ? (
            <SectionMessage appearance="information" title={m.restoredTitle}>
              <p>{m.restoredText}</p>
            </SectionMessage>
          ) : (
            <SectionMessage
              appearance="success"
              title={phase.moved ? m.movedTitle(phase.moved) : m.saved}
              actions={phase.previous ? <SectionMessageAction onClick={() => void restore(phase.previous!)}>{m.restore}</SectionMessageAction> : undefined}
            >
              <p>
                {phase.moved ? m.allInOrder(phase.total) : phase.keep ? m.ruleOn : m.ruleOff}
                {phase.moved && phase.keep ? m.staySorted : ""}
              </p>
            </SectionMessage>
          )}
        </div>
      ) : null}

      {phase.name === "stopped" ? (
        <div className="status">
          <SectionMessage appearance="information" title={m.stoppedTitle}>
            <p>
              {phase.moved ? m.alreadyMoved(phase.moved) : m.noneMoved}
              {phase.moved && savedRule !== null ? m.stillOn(m.orders[savedRule]) : ""}
            </p>
          </SectionMessage>
        </div>
      ) : null}

      {phase.name !== "loading" && phase.name !== "error" && children.length < 2 ? (
        <SectionMessage appearance="information" title={children.length === 0 ? m.noChildren : m.oneChild}>
          <p>{m.addChildren}</p>
        </SectionMessage>
      ) : null}

      {phase.name !== "loading" && phase.name !== "error" && children.length >= 2 ? (
        <div className="layout">
          <section aria-labelledby="order-heading">
            <Heading size="small" as="h2" id="order-heading">{m.order}</Heading>
            <RadioGroup
              options={orderOptions}
              value={order}
              isDisabled={busy}
              onChange={(event) => void chooseOrder(event.currentTarget.value as SortOrder)}
              aria-labelledby="order-heading"
            />
            <p className="hint">{m.naturalHint}</p>

            <div className="keep">
              {savedRule !== null ? (
                <p className="rule-on">{m.ruleOnWith(m.orders[savedRule])}</p>
              ) : null}
              <Checkbox
                isChecked={keep}
                isDisabled={busy}
                onChange={(event) => setKeep(event.currentTarget.checked)}
                label={m.keep}
                name="keep"
              />
              <p className="hint">{m.keepHint}</p>
            </div>
          </section>

          <section aria-labelledby="preview-heading">
            <Heading size="small" as="h2" id="preview-heading">{m.preview}</Heading>
            <p className="subtle" aria-live="polite">
              {waitingForDates
                ? m.readingDates
                : moves.length === 0
                  ? m.alreadyInOrder(children.length)
                  : m.willMove(children.length, moves.length)}
            </p>
            <ol className="preview" tabIndex={0} aria-label={m.newOrder}>
              {sorted.map((child) => (
                <li key={child.id} className={movingIds.has(child.id) ? "moving" : undefined}>
                  <span className="title">{child.title || m.untitled}</span>
                  {m.types[child.type] ? <span className="type">{m.types[child.type]}</span> : null}
                  {movingIds.has(child.id) ? <Lozenge appearance="moved">{m.moves}</Lozenge> : null}
                </li>
              ))}
            </ol>
          </section>
        </div>
      ) : null}

      </div>

      <footer>
        {busy ? (
          <Button onClick={() => controller.current?.abort()}>{m.cancel}</Button>
        ) : (
          <>
            <Button appearance={canSort ? "subtle" : "primary"} onClick={() => onClose(changed.current)}>{m.close}</Button>
            {canSort ? (
              <Button appearance="primary" isDisabled={nothingToDo || waitingForDates} onClick={() => void apply()}>
                {moves.length > 0 || !ruleChanged ? m.sortPages : !keep ? m.turnOff : savedRule !== null ? m.update : m.turnOn}
              </Button>
            ) : null}
          </>
        )}
      </footer>
    </main>
  );
}

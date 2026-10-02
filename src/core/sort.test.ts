import { describe, expect, it } from "vitest";
import { applyMovesLocally, planMoves, sortChildren, type Child } from "./sort";

const pages = (...titles: string[]): Child[] => titles.map((title, index) => ({ id: String(index + 1), title, type: "page" }));
const titles = (children: Child[]) => children.map((child) => child.title);

describe("natural title order (CA1)", () => {
  it("puts Page 2 before Page 10", () => {
    expect(titles(sortChildren(pages("Page 10", "Page 2", "Page 1"), "title-asc"))).toEqual(["Page 1", "Page 2", "Page 10"]);
  });

  it("orders release numbers naturally", () => {
    expect(titles(sortChildren(pages("Release 1.10", "Release 1.2", "Release 1.9"), "title-asc"))).toEqual(["Release 1.2", "Release 1.9", "Release 1.10"]);
  });

  it("ignores case and accents in French", () => {
    expect(titles(sortChildren(pages("Zèbre", "école", "Ecole normale", "abeille"), "title-asc", "fr-FR"))).toEqual(["abeille", "école", "Ecole normale", "Zèbre"]);
  });

  it("accepts Atlassian locales like fr_FR", () => {
    expect(titles(sortChildren(pages("Zèbre", "école", "Ecole normale", "abeille"), "title-asc", "fr_FR"))).toEqual(["abeille", "école", "Ecole normale", "Zèbre"]);
  });

  it("sorts Z to A", () => {
    expect(titles(sortChildren(pages("b", "c", "a"), "title-desc"))).toEqual(["c", "b", "a"]);
  });

  it("sorts by creation date, undated items last", () => {
    const children: Child[] = [
      { id: "1", title: "old", type: "page", createdAt: "2026-01-01T00:00:00Z" },
      { id: "2", title: "none", type: "folder" },
      { id: "3", title: "new", type: "page", createdAt: "2026-03-01T00:00:00Z" },
    ];
    expect(titles(sortChildren(children, "created-desc"))).toEqual(["new", "old", "none"]);
    expect(titles(sortChildren(children, "created-asc"))).toEqual(["old", "new", "none"]);
  });

  it("keeps the current order for equal titles", () => {
    const children = pages("Notes", "notes", "NOTES");
    expect(sortChildren(children, "title-asc").map((child) => child.id)).toEqual(["1", "2", "3"]);
  });
});

describe("move plan (CA2, CA3)", () => {
  it("plans no move for an already sorted list", () => {
    expect(planMoves(["1", "2", "3"], ["1", "2", "3"])).toEqual([]);
  });

  it("moves a single new page into place with one call", () => {
    const moves = planMoves(["a", "c", "d", "b"], ["a", "b", "c", "d"]);
    expect(moves).toEqual([{ id: "b", position: "after", targetId: "a" }]);
  });

  it("moves a page to the front with 'before'", () => {
    expect(planMoves(["b", "c", "a"], ["a", "b", "c"])).toEqual([{ id: "a", position: "before", targetId: "b" }]);
  });

  it("reverses a list with n - 1 moves", () => {
    const current = ["1", "2", "3", "4", "5"];
    const target = [...current].reverse();
    const moves = planMoves(current, target);
    expect(moves).toHaveLength(4);
    expect(applyMovesLocally(current, moves)).toEqual(target);
  });

  it("produces the exact target for random shuffles", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let run = 0; run < 200; run++) {
      const size = 1 + Math.floor(random() * 40);
      const current = Array.from({ length: size }, (_, i) => String(i));
      const target = [...current].sort(() => random() - 0.5);
      const moves = planMoves(current, target);
      expect(applyMovesLocally(current, moves)).toEqual(target);
      // Never more moves than pages out of place.
      expect(moves.length).toBeLessThan(size);
    }
  });

  it("rejects mismatched lists", () => {
    expect(() => planMoves(["1", "2"], ["1", "3"])).toThrow();
  });
});

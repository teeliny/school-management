import { assignPositions } from "./position-ranking.util";

describe("assignPositions (standard competition ranking)", () => {
  it("ranks distinct scores in descending order", () => {
    const positions = assignPositions([
      { id: "a", totalScore: 60 },
      { id: "b", totalScore: 90 },
      { id: "c", totalScore: 75 },
    ]);

    expect(positions.get("b")).toBe(1);
    expect(positions.get("c")).toBe(2);
    expect(positions.get("a")).toBe(3);
  });

  it("gives tied scores the same rank and skips the next rank accordingly", () => {
    const positions = assignPositions([
      { id: "a", totalScore: 90 },
      { id: "b", totalScore: 90 },
      { id: "c", totalScore: 60 },
    ]);

    expect(positions.get("a")).toBe(1);
    expect(positions.get("b")).toBe(1);
    expect(positions.get("c")).toBe(3);
  });

  it("assigns rank 1 to a single-result group", () => {
    const positions = assignPositions([{ id: "a", totalScore: 42 }]);

    expect(positions.get("a")).toBe(1);
  });

  it("handles an all-tied group by giving everyone rank 1", () => {
    const positions = assignPositions([
      { id: "a", totalScore: 50 },
      { id: "b", totalScore: 50 },
      { id: "c", totalScore: 50 },
    ]);

    expect(positions.get("a")).toBe(1);
    expect(positions.get("b")).toBe(1);
    expect(positions.get("c")).toBe(1);
  });
});

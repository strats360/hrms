import { describe, expect, it } from "vitest";
import { goalProblem, ratingDistribution, ratingLabel, weightedScore } from "../src/performance";

describe("performance scoring", () => {
  it("weights goal ratings and waits until every goal is rated", () => {
    expect(weightedScore([{ weight: 60, managerRating: 4 }, { weight: 40, managerRating: 3 }], "manager")).toBe(3.6);
    expect(weightedScore([{ weight: 60, selfRating: 4 }, { weight: 40, selfRating: null }], "self")).toBeNull();
    expect(weightedScore([], "self")).toBeNull();
  });
  it("labels scores by the nearest whole rating", () => {
    expect(ratingLabel(3.4)).toBe("Meets expectations");
    expect(ratingLabel(3.5)).toBe("Exceeds expectations");
    expect(ratingLabel(null)).toBe("");
  });
  it("checks goals before submitting", () => {
    expect(goalProblem([])).toMatch(/at least one/);
    expect(goalProblem([{ title: "A", weight: 60 }, { title: "B", weight: 30 }])).toMatch(/add up to 90%/);
    expect(goalProblem([{ title: " ", weight: 100 }])).toMatch(/title/);
    expect(goalProblem([{ title: "A", weight: 100 }])).toBeNull();
  });
  it("counts reviews per rating band", () => {
    expect(ratingDistribution([3.6, 4, 2.2, null, 5])).toEqual({ 1: 0, 2: 1, 3: 0, 4: 2, 5: 1 });
  });
});

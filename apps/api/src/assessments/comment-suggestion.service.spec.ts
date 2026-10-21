import { BadRequestException, ConflictException } from "@nestjs/common";
import { SkillGroupValueType } from "@prisma/client";
import { mentionsOnlyBand, pronounsFor } from "@school/types";
import { CommentSuggestionService, isAcceptableComment } from "./comment-suggestion";
import type { RequestUser } from "../auth/jwt.strategy";
import type { CommentSuggestionDto } from "./dto/comment-suggestion.dto";

const USER: RequestUser = { id: "user-1", roles: ["STAFF"], assignmentTypes: [] };

function setup(opts: { gender?: "MALE" | "FEMALE" | null; llmEnabled?: boolean; llmOutput?: string[] } = {}) {
  const prisma = {
    studentProfile: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: "student-1",
        currentClassId: "arm-1",
        user: { firstName: "Ada", gender: opts.gender === undefined ? "FEMALE" : opts.gender },
      }),
    },
    skillAssessmentItem: { findMany: jest.fn().mockResolvedValue([]) },
    skillRating: { findMany: jest.fn().mockResolvedValue([]) },
    studentSubjectEnrollment: { findMany: jest.fn().mockResolvedValue([{ subjectId: "math" }, { subjectId: "eng" }]) },
    subjectTermResult: { findMany: jest.fn().mockResolvedValue([{ subjectId: "math" }, { subjectId: "eng" }]) },
    classArm: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: "arm-1", classLevel: { category: "SSS" } }) },
    reportWindow: { findFirst: jest.fn().mockResolvedValue({ status: "OPEN" }) },
  };
  const reportComments = { authorize: jest.fn().mockResolvedValue("staff-1") };
  const broadsheet = {
    build: jest.fn().mockResolvedValue({ rows: [{ studentId: "student-1", overallAverage: 72.456 }] }),
  };
  const llm = {
    enabled: opts.llmEnabled ?? false,
    generate: jest.fn().mockResolvedValue(opts.llmOutput ?? []),
  };
  const service = new CommentSuggestionService(prisma as never, reportComments as never, broadsheet as never, llm as never);
  return { service, prisma, reportComments, broadsheet, llm };
}

function dto(overrides: Partial<CommentSuggestionDto> = {}): CommentSuggestionDto {
  return { studentId: "student-1", termId: "term-1", commentType: "PRINCIPAL", ...overrides };
}

describe("isAcceptableComment", () => {
  const she = pronounsFor("FEMALE");
  it("requires the band phrase and only that band", () => {
    expect(isAcceptableComment("A very good result. Keep it up, Ada.", { pronouns: she, band: "VERY_GOOD" })).toBe(true);
    expect(isAcceptableComment("A good result. Keep it up, Ada.", { pronouns: she, band: "VERY_GOOD" })).toBe(false);
    expect(isAcceptableComment("Keep working hard next term, Ada.", { pronouns: she, band: "GOOD" })).toBe(false);
  });
  it("rejects the wrong pronouns, and any pronoun when gender is unknown", () => {
    expect(isAcceptableComment("A good result. He should aim higher.", { pronouns: she, band: "GOOD" })).toBe(false);
    expect(isAcceptableComment("A good result. She should aim higher.", { pronouns: null, band: "GOOD" })).toBe(false);
    expect(isAcceptableComment("A good result. Ada should aim higher.", { pronouns: null, band: "GOOD" })).toBe(true);
  });
  it("rejects harsh wording even when the band is right", () => {
    expect(isAcceptableComment("A fair result, but Ada is lazy and must sit up.", { pronouns: she, band: "FAIR" })).toBe(false);
    expect(isAcceptableComment("A fair result. Ada can do better with more practice.", { pronouns: she, band: "FAIR" })).toBe(true);
  });

  it("rejects too-short text and leftover tokens", () => {
    expect(isAcceptableComment("Good.", { pronouns: she, band: "GOOD" })).toBe(false);
    expect(isAcceptableComment("A good result, {name}. Aim higher.", { pronouns: she, band: "GOOD" })).toBe(false);
  });
});

describe("CommentSuggestionService.suggest", () => {
  it("checks write permission before anything else", async () => {
    const { service, reportComments } = setup();
    reportComments.authorize.mockRejectedValue(new BadRequestException("nope"));
    await expect(service.suggest(dto(), USER, false)).rejects.toThrow("nope");
  });

  it("PRINCIPAL: returns 5 band-correct template suggestions from the broadsheet average", async () => {
    const { service, broadsheet } = setup();
    const res = await service.suggest(dto(), USER, false);
    expect(broadsheet.build).toHaveBeenCalledWith({ termId: "term-1", classArmId: "arm-1" });
    expect(res).toMatchObject({ source: "template", band: "VERY_GOOD", average: 72.46 });
    expect(res.suggestions).toHaveLength(5);
    for (const s of res.suggestions) expect(mentionsOnlyBand(s, "VERY_GOOD")).toBe(true);
  });

  it.each([["no window", null], ["a DRAFT window", { status: "DRAFT" }], ["a CLOSED window", { status: "CLOSED" }]])(
    "PRINCIPAL: a non-override user gets 409 and nothing is generated when there is %s",
    async (_label, window) => {
      const { service, prisma, broadsheet, llm } = setup({ llmEnabled: true });
      prisma.reportWindow.findFirst.mockResolvedValue(window);
      await expect(service.suggest(dto(), USER, false)).rejects.toThrow("report window is open");
      expect(broadsheet.build).not.toHaveBeenCalled();
      expect(llm.generate).not.toHaveBeenCalled();
    },
  );

  it("PRINCIPAL: refuses with 409 while any enrolled subject lacks a result", async () => {
    const { service, prisma } = setup();
    prisma.subjectTermResult.findMany.mockResolvedValue([{ subjectId: "math" }]);
    await expect(service.suggest(dto(), USER, false)).rejects.toBeInstanceOf(ConflictException);
  });

  it("uses valid LLM output, drops invalid ones, and tops up from templates", async () => {
    const { service } = setup({
      llmEnabled: true,
      llmOutput: [
        "A very impressive result, Ada. Keep aiming higher.",
        "An excellent result, Ada!", // wrong band
        "A very good result. He should keep it up.", // wrong pronoun
      ],
    });
    const res = await service.suggest(dto(), USER, false);
    expect(res.source).toBe("llm");
    expect(res.suggestions[0]).toBe("A very impressive result, Ada. Keep aiming higher.");
    expect(res.suggestions).toHaveLength(5);
    expect(res.suggestions).not.toContain("An excellent result, Ada!");
  });

  it("falls back to templates when the LLM returns nothing usable", async () => {
    const { service } = setup({ llmEnabled: true, llmOutput: [] });
    const res = await service.suggest(dto(), USER, false);
    expect(res.source).toBe("template");
    expect(res.suggestions).toHaveLength(5);
  });

  it("CLASS_TEACHER: builds suggestions from the form's (unsaved) ratings", async () => {
    const { service, prisma } = setup({ gender: null });
    prisma.skillAssessmentItem.findMany.mockResolvedValue([
      { id: "i1", name: "Punctuality", order: 1, group: { order: 1, valueType: SkillGroupValueType.RATING } },
      { id: "i2", name: "Neatness", order: 2, group: { order: 1, valueType: SkillGroupValueType.RATING } },
    ]);
    const res = await service.suggest(
      dto({
        commentType: "CLASS_TEACHER",
        skillRatings: [
          { skillAssessmentItemId: "i1", rating: "EXCELLENT" },
          { skillAssessmentItemId: "i2", rating: "POOR" },
        ],
      }),
      USER,
      false,
    );
    expect(res.suggestions).toHaveLength(5);
    expect(res.suggestions.join(" ")).toMatch(/punctuality|neatness/);
    for (const s of res.suggestions) expect(s).not.toMatch(/\b(he|she|him|her|his)\b/i);
  });

  it("CLASS_TEACHER: a class teacher gets nothing while the report window isn't OPEN", async () => {
    const { service, prisma, llm } = setup({ llmEnabled: true });
    prisma.reportWindow.findFirst.mockResolvedValue({ status: "CLOSED" });
    await expect(service.suggest(dto({ commentType: "CLASS_TEACHER" }), USER, false)).rejects.toThrow(
      "report window is open",
    );
    expect(prisma.skillRating.findMany).not.toHaveBeenCalled();
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it.each([["no window", null], ["a CLOSED window", { status: "CLOSED" }]])(
    "override users (Principal/Admin) still get suggestions with %s",
    async (_label, window) => {
      const { service, prisma } = setup();
      prisma.reportWindow.findFirst.mockResolvedValue(window);
      prisma.skillRating.findMany.mockResolvedValue([
        {
          rating: "EXCELLENT",
          skillAssessmentItem: { name: "Punctuality", order: 1, group: { order: 1, valueType: SkillGroupValueType.RATING } },
        },
      ]);
      const teacher = await service.suggest(dto({ commentType: "CLASS_TEACHER" }), USER, true);
      const principal = await service.suggest(dto(), USER, true);
      expect(teacher.suggestions).toHaveLength(5);
      expect(principal.suggestions).toHaveLength(5);
      expect(prisma.reportWindow.findFirst).not.toHaveBeenCalled();
    },
  );

  it("CLASS_TEACHER: 400 when nothing is rated yet", async () => {
    const { service } = setup();
    await expect(service.suggest(dto({ commentType: "CLASS_TEACHER" }), USER, false)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

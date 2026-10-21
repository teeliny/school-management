import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import {
  BAND_PHRASES,
  HARSH_WORDS,
  type PerformanceBand,
  type PronounSet,
  type SuggestibleCommentType,
} from "@school/types";
import type { SkillSummary } from "./comment-templates";

export interface LlmCommentInput {
  commentType: SuggestibleCommentType;
  firstName: string;
  pronouns: PronounSet | null;
  skills?: SkillSummary;
  band?: PerformanceBand;
  count: number;
}

const OutputSchema = z.object({ comments: z.array(z.string()) });

const DEFAULT_MODEL = "claude-sonnet-5-5";
const TIMEOUT_MS = 15_000;

/**
 * Optional generator for report-comment suggestions. It is enabled only when
 * ANTHROPIC_API_KEY is set; otherwise `enabled` is false and the caller uses
 * the template bank alone. It never throws: any API error, refusal or
 * timeout returns [] and the caller falls back to templates. Its output is
 * never trusted as-is either, since CommentSuggestionService re-validates
 * every comment (band phrase, pronouns, length) before showing it.
 *
 * Privacy: only the first name, pronouns, skill names and ratings, and the
 * performance band leave the server. The surname, IDs and raw scores are
 * never sent.
 */
@Injectable()
export class CommentLlmGenerator {
  private readonly logger = new Logger(CommentLlmGenerator.name);
  private readonly client: Anthropic | null;
  private readonly model: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>("ANTHROPIC_API_KEY");
    this.client = apiKey
      ? new Anthropic({ apiKey, timeout: TIMEOUT_MS, maxRetries: 1 })
      : null;
    this.model =
      config.get<string>("COMMENT_SUGGESTION_MODEL") || DEFAULT_MODEL;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async generate(input: LlmCommentInput): Promise<string[]> {
    if (!this.client) return [];
    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: 2000,
        output_config: { effort: "low", format: zodOutputFormat(OutputSchema) },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(input) }],
      });
      if (response.stop_reason === "refusal") {
        this.logger.warn(
          "Comment suggestion request was refused; falling back to templates",
        );
        return [];
      }
      return response.parsed_output?.comments ?? [];
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        this.logger.warn(
          `Comment suggestion LLM call failed (${err.status ?? "network"}): ${err.message}`,
        );
      } else {
        this.logger.warn(`Comment suggestion LLM call failed: ${String(err)}`);
      }
      return [];
    }
  }
}

const SYSTEM_PROMPT = `You write end-of-term report card comments for a Nigerian primary/secondary school.
Write in British English, in the warm, concise, professional tone Nigerian teachers use on report cards.
Every comment must be friendly, kind and encouraging, even when the result or behaviour needs improvement. Describe the result or the habit, never label the child, and always end on a hopeful or motivating note.
Each comment is one or two short sentences (under 200 characters), and the comments you return must all be different from one another in wording and structure.
Never mention the student's surname, scores, positions, or anything not given to you.
Follow the pronoun instruction exactly.
Never use any of these harsh words: ${HARSH_WORDS.map((w) => `"${w}"`).join(", ")}.`;

function buildUserPrompt(input: LlmCommentInput): string {
  const lines: string[] = [];
  lines.push(`Write exactly ${input.count} alternative comments.`);
  lines.push(
    `Student's first name: ${input.firstName}. Use the first name in some comments but not all.`,
  );
  if (input.pronouns) {
    lines.push(
      `Pronouns: ${input.pronouns.subj}/${input.pronouns.obj}/${input.pronouns.poss}. Never use any other pronouns for the student.`,
    );
  } else {
    lines.push(
      "Do not use any gendered pronouns (he, she, him, her, his, hers). Refer to the student by first name or as 'this pupil'.",
    );
  }

  if (input.commentType === "CLASS_TEACHER" && input.skills) {
    lines.push(
      "You are the class teacher. Base the comments on these skill/behaviour ratings from this term:",
    );
    if (input.skills.strengths.length)
      lines.push(
        `- Strengths (rated excellent/very good): ${input.skills.strengths.join(", ")}`,
      );
    if (input.skills.satisfactory.length)
      lines.push(
        `- Satisfactory (rated good): ${input.skills.satisfactory.join(", ")}`,
      );
    if (input.skills.weak.length)
      lines.push(
        `- Still developing (needs gentle encouragement): ${input.skills.weak.join(", ")}`,
      );
    lines.push(
      "Praise strengths and gently encourage improvement where needed. Do not comment on academic grades.",
    );
  }

  if (input.commentType === "PRINCIPAL" && input.band) {
    const phrases = BAND_PHRASES[input.band];
    lines.push(
      "You are the principal/head teacher, commenting on the student's overall academic result this term.",
    );
    lines.push(
      `Every comment MUST describe the result or performance using one of these exact words/phrases: ${phrases
        .map((p) => `"${p}"`)
        .join(", ")}. Vary which one you use across the comments.`,
    );
    const otherPhrases = Object.entries(BAND_PHRASES)
      .filter(([band]) => band !== input.band)
      .flatMap(([, list]) => list)
      .filter((p) => !phrases.some((own) => own.includes(p)));
    lines.push(
      `Do not use any of these other words anywhere in the comment: ${otherPhrases.map((p) => `"${p}"`).join(", ")}.`,
    );
    if (input.band === "POOR") {
      lines.push(
        "Be gentle and honest: say the result is below expectation, then reassure that the student can improve with effort and support from home and school.",
      );
    }
  }
  return lines.join("\n");
}

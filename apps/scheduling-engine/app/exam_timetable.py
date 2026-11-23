"""
BUILD_PLAN.md §9 Step 3: the CP-SAT model for `scope=EXAM_TIMETABLE`.

Simpler than class_timetable.py in two ways, both discovered from PRD's
`ExamSchedule` field list: there's no `staffId` (a subject's own teacher
isn't tied to when their students sit the exam — that's invigilation, Step
4, a separate staff pool), and there's no shared resource across class arms
(no teacher, no venue catalog), so each class arm's exam schedule is solved
**independently** here — unlike class_timetable.py's per-group solve.

Exception: a `unified` sitting (examArrangementFor in packages/types — JSS+SSS
for both mid-term and exam, Basic 1-6 for the terminal exam) is ONE combined
model on a shared fixed slot grid, see _solve_unified.
"""

from datetime import date
from typing import Any

from ortools.sat.python import cp_model
from pydantic import BaseModel, Field


class ExamSubjectPayload(BaseModel):
    subjectId: str
    requiresCalculation: bool
    # "Options column" membership (ClassSubjectConcurrencyGroup), same
    # concept and id space as class_timetable.py's SubjectPayload — bundle
    # members sit their exam on the exact same day (a student only ever sits
    # one of them), so the day only costs 1 unit of max_subjects_per_day, not
    # N. None means "not part of a bundle."
    concurrencyGroupId: str | None = None
    # {EXAM,MID_TERM}_LAST_DAYS_SUBJECTS: only the exam period's last
    # `last_days_window` days are open to this paper (and, via the shared
    # variable, to its whole bundle).
    lastDaysOnly: bool = False
    # {EXAM,MID_TERM}_FIRST_PAPER_SUBJECTS: always the first paper of
    # whichever day it lands on — so no two of them share a day.
    firstPaper: bool = False
    # {EXAM,MID_TERM}_AFTERNOON_SUBJECTS: the LAST paper of whichever day it
    # lands on, and never its first — that day always has an earlier
    # (morning) paper too.
    afternoon: bool = False
    # {EXAM,MID_TERM}_SUBJECT_ALLOWED_DAYS: weekday names ("TUESDAY") this
    # paper should be sat on; None = any exam day. Soft (OFF_WEEKDAY_PENALTY):
    # when the exam period has no such weekday, or it can't take the paper,
    # the paper moves to another day rather than failing the run.
    allowedDays: list[str] | None = None


class ExistingLoadPayload(BaseModel):
    count: int
    hasCalc: bool


class ExamClassArmPayload(BaseModel):
    classArmId: str
    # Unified sittings only: arms of the same ClassLevel sit the identical
    # paper at the identical time (they share one set of decision variables).
    classLevelId: str | None = None
    # Echoed back on every generated row — a unified JSS/SSS sitting spans two
    # AssessmentComponents (one per category), so the callback can't assume
    # the request's own component for every row.
    assessmentComponentId: str | None = None
    subjects: list[ExamSubjectPayload]
    existingByDate: dict[str, ExistingLoadPayload] = Field(default_factory=dict)
    # Unified sittings: with align_class_levels, every ClassLevel sharing an
    # alignment group (its ClassLevelCategory — JSS 1-3, SSS 1-3) sits each
    # paper they have in common in the same slot (hard).
    # Per-arm (non-unified) sittings: arms sharing an alignment group
    # (their ClassLevelCategory — all Basic classes, Nursery 1 & 2) sit each
    # subject they have in common on the same day and in the same paper
    # position wherever the other rules allow (ALIGN_PENALTY). None = solved
    # with no reference to any other arm.
    alignmentGroup: str | None = None
    # Human-readable "ClassLevel Arm" for error messages only.
    label: str | None = None


SOLVE_TIME_LIMIT_SECONDS = 20.0
UNIFIED_SOLVE_TIME_LIMIT_SECONDS = 45.0

# Objective weights. Packing (fill each exam day up to its slot capacity
# before using a later day) is the baseline nudge; the others dominate it.
CALC_NOT_FIRST_PENALTY = 1000
CROSS_LEVEL_MISALIGN_PENALTY = 50
# {EXAM,MID_TERM}_SPREAD_PAPERS_ACROSS_DAYS: an exam day a class sits nothing
# on is the costliest outcome, then an uneven spread (busiest day minus
# quietest day). Both dominate packing, calc-first and cross-level alignment.
EMPTY_DAY_PENALTY = 20000
SPREAD_BALANCE_PENALTY = 2000
# {EXAM,MID_TERM}_SUBJECT_ALLOWED_DAYS: outweighs everything else, so the
# weekday is honored whenever the exam period has one that can take the paper.
OFF_WEEKDAY_PENALTY = 100000
# Per-arm alignment (ExamClassArmPayload.alignmentGroup): per subject sat on
# a different day from the group's reference arm. Below the spread penalties,
# so an even spread still wins over copying the reference's days.
ALIGN_PENALTY = 500

_WEEKDAY_NAMES = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]


def _day_allowed(members: list[ExamSubjectPayload], day: str, first_dates: set[str] | None = None) -> bool:
    """
    Whether every member of a bundle may sit on `day` ("YYYY-MM-DD") under its
    allowedDays. With `first_dates` ({prefix}_SUBJECT_ALLOWED_DAYS_FIRST_ONLY),
    a pinned paper also needs `day` to be the exam period's first date of
    that weekday — "MUSIC:TUESDAY" then means the first Tuesday only.
    """
    weekday = _WEEKDAY_NAMES[date.fromisoformat(day).weekday()]
    pinned = any(m.allowedDays is not None for m in members)
    if pinned and first_dates is not None and day not in first_dates:
        return False
    return all(m.allowedDays is None or weekday in m.allowedDays for m in members)


def _first_weekday_dates(days: list[str]) -> set[str]:
    """The first date of each weekday within the exam period."""
    seen: dict[int, str] = {}
    for d in days:
        seen.setdefault(date.fromisoformat(d).weekday(), d)
    return set(seen.values())


def _spread_terms(model: cp_model.CpModel, loads: list[Any], max_load: int, name: str) -> list[Any]:
    """
    Objective terms spreading one class's papers over every exam day: a
    penalty per empty day, plus one on (busiest - quietest) day load. `loads`
    is one linear expression (or plain int) per exam day.
    """
    terms: list[Any] = []
    busiest = model.new_int_var(0, max_load, f"busiest_{name}")
    quietest = model.new_int_var(0, max_load, f"quietest_{name}")
    for d, load in enumerate(loads):
        model.add(busiest >= load)
        model.add(quietest <= load)
        if isinstance(load, int):
            if load == 0:
                terms.append(EMPTY_DAY_PENALTY)
            continue
        empty = model.new_bool_var(f"empty_{name}_{d}")
        model.add(load >= 1).only_enforce_if(empty.Not())
        terms.append(EMPTY_DAY_PENALTY * empty)
    terms.append(SPREAD_BALANCE_PENALTY * (busiest - quietest))
    return terms


class _DailyLimits:
    """Hard per-class daily paper-count limits ({prefix}_MIN_PAPERS_PER_DAY, _MAX_DAILY_PAPER_DIFFERENCE)."""

    def __init__(self, min_per_day: int, max_difference: int | None, front_load: bool = False):
        self.min_per_day = max(0, min_per_day)
        self.max_difference = max_difference if max_difference is not None and max_difference >= 0 else None
        # {prefix}_FRONT_LOAD_PAPERS: a class's daily paper count never rises
        # from one exam day to the next — extra papers go on the earliest days
        # (e.g. 17 papers over 8 days at most 1 apart = a 3 on day 1, then 2s).
        self.front_load = front_load

    @property
    def active(self) -> bool:
        return self.min_per_day > 0 or self.max_difference is not None or self.front_load


def _add_daily_limits(model: cp_model.CpModel, loads: list[Any], max_load: int, daily: _DailyLimits, name: str) -> None:
    """Each day's load >= min_per_day, and busiest - quietest <= max_difference. `loads` as in _spread_terms."""
    if not daily.active:
        return
    if daily.min_per_day > 0:
        for load in loads:
            if not isinstance(load, int):
                model.add(load >= daily.min_per_day)
    if daily.max_difference is not None and len(loads) > 1:
        busiest = model.new_int_var(0, max_load, f"hard_busiest_{name}")
        quietest = model.new_int_var(0, max_load, f"hard_quietest_{name}")
        for load in loads:
            model.add(busiest >= load)
            model.add(quietest <= load)
        model.add(busiest - quietest <= daily.max_difference)
    if daily.front_load:
        for earlier, later in zip(loads, loads[1:]):
            if isinstance(earlier, int) and isinstance(later, int):
                continue
            model.add(earlier >= later)


def _check_capacity(
    class_arms: list[ExamClassArmPayload],
    days: list[str],
    max_per_day: int,
    daily: _DailyLimits,
    unified: bool,
) -> str | None:
    """
    Whether each class's paper count (a bundle = one paper, plus papers
    already on the exam days) fits `days` at max_per_day — and, with the hard
    daily limits, at least min_per_day a day. One check per ClassLevel on a
    unified sitting (its arms share papers), per arm otherwise.
    """
    day_count = len(days)
    seen_levels: set[str] = set()
    for arm in class_arms:
        who = arm.label or arm.classArmId
        if unified:
            level_key = arm.classLevelId or arm.classArmId
            if level_key in seen_levels:
                continue
            seen_levels.add(level_key)
            who = who.rsplit(" ", 1)[0] if arm.label and " " in arm.label else who
        papers = len({s.concurrencyGroupId or s.subjectId for s in arm.subjects})
        papers += sum(e.count for d, e in arm.existingByDate.items() if d in days)
        if papers > day_count * max_per_day:
            needed = -(-papers // max_per_day)
            return (
                f"{who} has {papers} papers but {day_count} exam days x {max_per_day} papers/day only holds "
                f"{day_count * max_per_day} — it needs at least {needed} exam days, or a higher papers-per-day limit"
            )
        if daily.min_per_day > 0 and papers < day_count * daily.min_per_day:
            return (
                f"{who} has only {papers} papers, fewer than {daily.min_per_day} a day over {day_count} exam days "
                f"— shorten the exam period or lower MIN_PAPERS_PER_DAY"
            )
    return None


def solve_exam_timetable(
    request_id: str,
    callback_token: str,
    days: list[str],
    exam_day_start_time: str,
    max_subjects_per_day: int,
    calculation_subject_duration_minutes: int,
    non_calculation_subject_duration_minutes: int,
    spread_calculation_subjects: bool,
    min_gap_between_calculation_exams_days: int,
    class_arms: list[ExamClassArmPayload],
    unified: bool = False,
    exam_day_end_time: str | None = None,
    calculation_subjects_morning: bool = True,
    last_days_window: int = 2,
    break_after_paper: int = 0,
    break_duration_minutes: int = 0,
    spread_papers_across_days: bool = False,
    min_papers_per_day: int = 0,
    max_daily_paper_difference: int | None = None,
    front_load_papers: bool = False,
    align_class_levels: bool = False,
    allowed_days_first_only: bool = False,
) -> dict[str, Any]:
    window_minutes = _window_minutes(exam_day_start_time, exam_day_end_time)
    # {prefix}_MIN_PAPERS_PER_DAY / _MAX_DAILY_PAPER_DIFFERENCE: HARD limits on
    # each class's daily paper count (unlike SPREAD_PAPERS_ACROSS_DAYS, which
    # only nudges). Checked up front so an impossible paper count fails with
    # the class and the arithmetic named, not a bare "no feasible timetable".
    daily = _DailyLimits(min_papers_per_day, max_daily_paper_difference, front_load_papers)
    first_dates = _first_weekday_dates(days) if allowed_days_first_only else None
    capacity_error = _check_capacity(class_arms, days, max_subjects_per_day, daily, unified)
    if capacity_error:
        return {"callbackToken": callback_token, "error": f"{capacity_error} (requestId={request_id})"}
    # {prefix}_BREAK_AFTER_PAPER/_DURATION_MINUTES: a break of N minutes after
    # the day's Nth paper. 0 for either disables it.
    exam_break = (break_after_paper, break_duration_minutes) if break_after_paper > 0 and break_duration_minutes > 0 else None

    if unified:
        rows = _solve_unified(
            class_arms,
            days,
            exam_day_start_time,
            max_subjects_per_day,
            calculation_subject_duration_minutes,
            non_calculation_subject_duration_minutes,
            spread_calculation_subjects,
            min_gap_between_calculation_exams_days,
            window_minutes,
            calculation_subjects_morning,
            last_days_window,
            exam_break,
            spread_papers_across_days,
            daily,
            align_class_levels,
            first_dates,
        )
        if isinstance(rows, str):
            return {"callbackToken": callback_token, "error": f"{rows} (requestId={request_id})"}
        return {"callbackToken": callback_token, "result": {"generatedRows": rows}}

    generated_rows: list[dict[str, Any]] = []
    # Per alignment group: subjectId -> (date, paper position) as first sat
    # by the group's reference arm — the arm with the most papers, solved
    # first, so the others line their shared subjects up with it.
    references: dict[str, dict[str, tuple[str, int]]] = {}
    for arm in sorted(class_arms, key=lambda a: -len(a.subjects)):
        reference = references.setdefault(arm.alignmentGroup, {}) if arm.alignmentGroup else None
        rows = _solve_class_arm(
            arm,
            days,
            exam_day_start_time,
            max_subjects_per_day,
            calculation_subject_duration_minutes,
            non_calculation_subject_duration_minutes,
            spread_calculation_subjects,
            min_gap_between_calculation_exams_days,
            window_minutes,
            last_days_window,
            exam_break,
            spread_papers_across_days,
            reference,
            daily,
            first_dates,
        )
        if rows is None:
            return {
                "callbackToken": callback_token,
                "error": f"No feasible exam timetable found for class arm {arm.label or arm.classArmId} (requestId={request_id})",
            }
        generated_rows.extend(rows)
        if reference is not None:
            # Subjects only a later arm has (e.g. Nursery 2's Multiplication)
            # extend the reference too, for any third arm that shares them.
            for date_rows in _rows_by_date(rows).values():
                for position, row in enumerate(date_rows):
                    reference.setdefault(row["subjectId"], (row["date"], position))

    return {"callbackToken": callback_token, "result": {"generatedRows": generated_rows}}


def _rows_by_date(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Generated rows grouped by date, each day's rows in paper order."""
    by_date: dict[str, list[dict[str, Any]]] = {}
    for row in sorted(rows, key=lambda r: (r["date"], r["startTime"])):
        by_date.setdefault(row["date"], []).append(row)
    return by_date


def _order_day(subjects: list[ExamSubjectPayload], reference_positions: dict[str, int]) -> list[ExamSubjectPayload]:
    """
    A day's paper order: a FIRST_PAPER_SUBJECTS paper opens the day; a paper
    the alignment reference sat on this same day keeps the reference's
    position where that's free (so shared papers start together across the
    group); the rest fill the remaining positions calculation-first. An
    AFTERNOON_SUBJECTS paper takes the day's last position(s) — never the
    first; the solver guarantees an earlier paper exists. Always positions
    0..n-1, so a short day's free slots stay at its end.
    """
    count = len(subjects)
    remaining = sorted(subjects, key=lambda s: (0 if s.firstPaper else 1, 0 if s.requiresCalculation else 1))
    slots: list[ExamSubjectPayload | None] = [None] * count
    if remaining and remaining[0].firstPaper:
        slots[0] = remaining.pop(0)
    position = count - 1
    for subject in [s for s in remaining if s.afternoon]:
        while position > 0 and slots[position] is not None:
            position -= 1
        if position <= 0:
            break
        slots[position] = subject
        remaining.remove(subject)
    for subject in list(remaining):
        position = reference_positions.get(subject.subjectId)
        if position is not None and position < count and slots[position] is None:
            slots[position] = subject
            remaining.remove(subject)
    fill = iter(remaining)
    return [slot if slot is not None else next(fill) for slot in slots]


def _solve_class_arm(
    arm: ExamClassArmPayload,
    days: list[str],
    exam_day_start_time: str,
    max_subjects_per_day: int,
    calc_duration: int,
    non_calc_duration: int,
    spread_calc: bool,
    min_gap: int,
    window_minutes: int | None,
    last_days_window: int,
    exam_break: tuple[int, int] | None,
    spread: bool = False,
    reference: dict[str, tuple[str, int]] | None = None,
    daily: _DailyLimits | None = None,
    first_dates: set[str] | None = None,
) -> list[dict[str, Any]] | None:
    model = cp_model.CpModel()
    day_count = len(days)

    existing_calc_day_indices = {
        i for i, d in enumerate(days) if (existing := arm.existingByDate.get(d)) and existing.hasCalc
    }

    # Days a NEW calculation subject can't land on because they fall within
    # min_gap of an existing calculation-subject exam date (measured in
    # exam-day-list positions, not raw calendar days — weekends already
    # aren't in `days` at all, so they shouldn't count toward the gap).
    blocked_calc_days: set[int] = set()
    if min_gap > 0:
        for i in range(day_count):
            for existing_idx in existing_calc_day_indices:
                if abs(i - existing_idx) < min_gap:
                    blocked_calc_days.add(i)

    subject_by_id = {s.subjectId: s for s in arm.subjects}

    def group_key(subject: ExamSubjectPayload) -> str:
        return subject.concurrencyGroupId or subject.subjectId

    # Group this arm's subjects by "options column" membership — an
    # ungrouped subject is its own singleton group, so the same code path
    # below covers both cases (same pattern as class_timetable.py).
    groups: dict[str, list[ExamSubjectPayload]] = {}
    for subject in arm.subjects:
        groups.setdefault(group_key(subject), []).append(subject)

    assign: dict[tuple[str, int], Any] = {}
    for key, members in groups.items():
        for day_idx in range(day_count):
            # The gap-block only actually applies to a calculation-subject
            # exam — but if ANY bundle member requires calculation, the whole
            # bundle lands on this day if chosen, so the restriction covers
            # the group as soon as one member needs it.
            if any(m.requiresCalculation for m in members) and day_idx in blocked_calc_days:
                continue
            if any(m.lastDaysOnly for m in members) and day_idx < day_count - last_days_window:
                continue
            # Every member points at the SAME BoolVar object — this alone
            # forces bundle-mates onto the identical exam day, the same
            # "reuse the variable" trick class_timetable.py uses for shared
            # period slots. The existing per-subject "exactly one day" and
            # per-day capacity constraints below already read
            # assign[(subjectId, day_idx)] independently per subject, so
            # sharing the object keeps every member in lockstep for free.
            shared_var = model.new_bool_var(f"assign_{key}_{day_idx}")
            for member in members:
                assign[(member.subjectId, day_idx)] = shared_var

    # Exactly one day per subject — the whole exam period, not per-week
    # (unlike class_timetable.py's periodsPerWeek repetition).
    for subject in arm.subjects:
        subject_vars = [v for (sid, _d), v in assign.items() if sid == subject.subjectId]
        if not subject_vars:
            # No open day exists for this subject at all (e.g. every day is
            # gap-blocked) — fail fast rather than build a doomed model.
            return None
        model.add(sum(subject_vars) == 1)

    # Daily capacity: existing load + new assignments <= max_subjects_per_day.
    # Deduped by group_key so an N-member bundle (all sharing the identical
    # variable at this day_idx, set up above) costs 1 unit of capacity, not
    # N — a student only ever sits one of them. Each day's load is kept for
    # the spread objective below.
    day_loads: list[Any] = []
    for day_idx, day in enumerate(days):
        existing = arm.existingByDate.get(day)
        existing_count = existing.count if existing else 0
        seen_groups: set[str] = set()
        day_vars = []
        for (sid, d), v in assign.items():
            if d != day_idx or group_key(subject_by_id[sid]) in seen_groups:
                continue
            seen_groups.add(group_key(subject_by_id[sid]))
            day_vars.append(v)
        if day_vars:
            model.add(sum(day_vars) + existing_count <= max_subjects_per_day)
        day_loads.append(sum(day_vars) + existing_count if day_vars else existing_count)

    # FIRST_PAPER_SUBJECTS: each opens its day, so at most one per day.
    for day_idx in range(day_count):
        seen_first_groups: set[str] = set()
        first_vars = []
        for (sid, d), v in assign.items():
            key = group_key(subject_by_id[sid])
            if d != day_idx or key in seen_first_groups or not any(m.firstPaper for m in groups[key]):
                continue
            seen_first_groups.add(key)
            first_vars.append(v)
        if len(first_vars) > 1:
            model.add(sum(first_vars) <= 1)

    # AFTERNOON_SUBJECTS: a day holding one needs at least one other (non-
    # afternoon) paper to open it — existing papers on the day count, since
    # they're already sitting in some slot ahead of it.
    for day_idx, day in enumerate(days):
        existing = arm.existingByDate.get(day)
        existing_count = existing.count if existing else 0
        seen_day_groups: set[str] = set()
        afternoon_vars = []
        opener_vars = []
        for (sid, d), v in assign.items():
            key = group_key(subject_by_id[sid])
            if d != day_idx or key in seen_day_groups:
                continue
            seen_day_groups.add(key)
            (afternoon_vars if any(m.afternoon for m in groups[key]) else opener_vars).append(v)
        for v in afternoon_vars:
            model.add(sum(opener_vars) + existing_count >= v)

    # SPREAD_CALCULATION_SUBJECTS: at most one calculation-subject exam per
    # day, counting existing load too — same per-group dedupe as above.
    if spread_calc:
        calc_subject_ids = {s.subjectId for s in arm.subjects if s.requiresCalculation}
        for day_idx, day in enumerate(days):
            existing = arm.existingByDate.get(day)
            existing_has_calc = 1 if existing and existing.hasCalc else 0
            seen_calc_groups: set[str] = set()
            day_calc_vars = []
            for (sid, d), v in assign.items():
                if d != day_idx or sid not in calc_subject_ids:
                    continue
                key = group_key(subject_by_id[sid])
                if key in seen_calc_groups:
                    continue
                seen_calc_groups.add(key)
                day_calc_vars.append(v)
            if day_calc_vars:
                model.add(sum(day_calc_vars) + existing_has_calc <= 1)

    # MIN_GAP_BETWEEN_CALCULATION_EXAMS_DAYS between every pair of NEW
    # calculation subjects — day_of[s] is a linear expression (no separate
    # IntVar needed), gap enforced via the standard CP-SAT disjunctive-order
    # idiom (a boolean "i-before-j" variable gating two one-directional
    # inequalities), same technique class as class_timetable.py's teacher
    # no-double-booking handling. Deduped to one representative subject per
    # bundle — two calc subjects in the same bundle land on the identical day
    # by design, so they must never be gap-checked against each other.
    seen_calc_group_keys: set[str] = set()
    calc_subject_ids_list: list[str] = []
    for s in arm.subjects:
        if not s.requiresCalculation:
            continue
        key = group_key(s)
        if key in seen_calc_group_keys:
            continue
        seen_calc_group_keys.add(key)
        calc_subject_ids_list.append(s.subjectId)
    if min_gap > 0 and len(calc_subject_ids_list) > 1:
        day_of: dict[str, Any] = {}
        for sid in calc_subject_ids_list:
            terms = [day_idx * v for (s, day_idx), v in assign.items() if s == sid]
            if terms:
                day_of[sid] = sum(terms)
        ids_with_var = list(day_of.keys())
        for i in range(len(ids_with_var)):
            for j in range(i + 1, len(ids_with_var)):
                a, b = ids_with_var[i], ids_with_var[j]
                before = model.new_bool_var(f"before_{a}_{b}")
                model.add(day_of[b] - day_of[a] >= min_gap).only_enforce_if(before)
                model.add(day_of[a] - day_of[b] >= min_gap).only_enforce_if(before.Not())

    # EXAM_DAY_END_TIME (optional): the papers a day holds must also fit the
    # exam-day window by DURATION, not just by MAX_SUBJECTS_PER_DAY's count —
    # e.g. a 09:00-12:00 window fits three 60-min papers but only two 90-min
    # ones. One representative per bundle (members sit in parallel); a
    # bundle costs its longest member's duration. Existing papers already
    # on that day are approximated at the non-calculation duration (their
    # real durations aren't in the payload).
    if window_minutes is not None:
        # Conservative: reserve the break inside the window whenever one is
        # configured (whether or not a given day actually runs past it).
        if exam_break:
            window_minutes = max(0, window_minutes - exam_break[1])
        for day_idx, day in enumerate(days):
            existing = arm.existingByDate.get(day)
            existing_minutes = (existing.count if existing else 0) * non_calc_duration
            seen_window_groups: set[str] = set()
            terms = []
            for (sid, d), v in assign.items():
                key = group_key(subject_by_id[sid])
                if d != day_idx or key in seen_window_groups:
                    continue
                seen_window_groups.add(key)
                duration = max(calc_duration if m.requiresCalculation else non_calc_duration for m in groups[key])
                terms.append(duration * v)
            if terms:
                model.add(sum(terms) + existing_minutes <= window_minutes)

    # Fill each exam day up to its capacity before spilling onto a later day
    # (the day's subject count follows from its slots/window, rather than the
    # papers being thinned out across the whole exam period) — unless
    # SPREAD_PAPERS_ACROSS_DAYS, where packing only breaks ties between
    # equally even spreads (extra papers go on the earlier days).
    objective_terms: list[Any] = []
    for key in groups:
        representative = groups[key][0].subjectId
        objective_terms.extend(day_idx * v for (sid, day_idx), v in assign.items() if sid == representative)
    if spread:
        objective_terms.extend(_spread_terms(model, day_loads, max_subjects_per_day, arm.classArmId))
    if daily:
        _add_daily_limits(model, day_loads, max_subjects_per_day, daily, arm.classArmId)
    for key, members in groups.items():
        representative = members[0].subjectId
        objective_terms.extend(
            OFF_WEEKDAY_PENALTY * v
            for (sid, day_idx), v in assign.items()
            if sid == representative and not _day_allowed(members, days[day_idx], first_dates)
        )
    if reference:
        for (sid, day_idx), v in assign.items():
            if sid in reference and reference[sid][0] != days[day_idx]:
                objective_terms.append(ALIGN_PENALTY * v)
    if objective_terms:
        model.minimize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = SOLVE_TIME_LIMIT_SECONDS
    status = solver.solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return None

    subjects_by_day: dict[int, list[ExamSubjectPayload]] = {i: [] for i in range(day_count)}
    for (sid, day_idx), var in assign.items():
        if solver.value(var):
            subjects_by_day[day_idx].append(subject_by_id[sid])

    rows: list[dict[str, Any]] = []
    for day_idx, day in enumerate(days):
        day_subjects = subjects_by_day[day_idx]
        if not day_subjects:
            continue
        # FIRST_PAPER_SUBJECTS first, then calculation subject(s) (FR6.3's
        # "earliest slot") unless the alignment reference fixes a position
        # (_order_day), back to back — except for the configured break after
        # the day's Nth paper. Back to back from the day's start means a day
        # with fewer papers than slots leaves its LAST slot(s) free.
        reference_positions = {
            sid: position for sid, (ref_day, position) in (reference or {}).items() if ref_day == day
        }
        ordered = _order_day(day_subjects, reference_positions)
        cursor_minutes = _time_to_minutes(exam_day_start_time)
        for paper_idx, subject in enumerate(ordered):
            if exam_break and paper_idx == exam_break[0]:
                cursor_minutes += exam_break[1]
            duration = calc_duration if subject.requiresCalculation else non_calc_duration
            rows.append(
                {
                    "classArmId": arm.classArmId,
                    "assessmentComponentId": arm.assessmentComponentId,
                    "subjectId": subject.subjectId,
                    "date": day,
                    "startTime": _minutes_to_time(cursor_minutes),
                    "endTime": _minutes_to_time(cursor_minutes + duration),
                }
            )
            cursor_minutes += duration

    return rows


def _solve_unified(
    class_arms: list[ExamClassArmPayload],
    days: list[str],
    exam_day_start_time: str,
    max_subjects_per_day: int,
    calc_duration: int,
    non_calc_duration: int,
    spread_calc: bool,
    min_gap: int,
    window_minutes: int | None,
    calculation_subjects_morning: bool,
    last_days_window: int,
    exam_break: tuple[int, int] | None,
    spread: bool = False,
    daily: _DailyLimits | None = None,
    align_class_levels: bool = False,
    first_dates: set[str] | None = None,
) -> list[dict[str, Any]] | str:
    """
    One combined model for a whole sitting (examArrangementFor's `unified`
    sittings: JSS+SSS, or Basic 1-6 for the terminal exam) — every arm shares
    the SAME fixed paper slots per day, so all classes start each paper
    together (the precondition for mixing classes in one hall, and for the
    sitting to read as one timetable). Slot length is the longer of the two
    durations; a shorter (non-calculation) paper starts with its slot and
    simply finishes earlier.

    The unit of scheduling is (ClassLevel, bundle): every arm of a ClassLevel
    sits the identical paper at the identical time. Across ClassLevels, a
    subject shared by several levels is nudged (soft) onto the same slot so
    the sitting reads as "Monday 09:00 — Mathematics, all classes" where the
    rest of the constraints allow it.
    """
    model = cp_model.CpModel()
    day_count = len(days)
    slot_length = max(calc_duration, non_calc_duration)
    slots_per_day = max_subjects_per_day
    if window_minutes is not None:
        # Count the slots that end within the window, break included.
        slots_per_day = sum(
            1 for k in range(max_subjects_per_day) if _slot_offset(k, slot_length, exam_break) + slot_length <= window_minutes
        )
    if slots_per_day <= 0 or day_count == 0:
        return "No exam slots available — check the exam dates, EXAM_DAY_START_TIME/EXAM_DAY_END_TIME and the per-day subject count"

    # ClassLevel -> its arms. Arms without a classLevelId are their own level.
    arms_by_level: dict[str, list[ExamClassArmPayload]] = {}
    for arm in class_arms:
        arms_by_level.setdefault(arm.classLevelId or arm.classArmId, []).append(arm)

    def group_key(subject: ExamSubjectPayload) -> str:
        return subject.concurrencyGroupId or subject.subjectId

    level_groups: dict[str, dict[str, list[ExamSubjectPayload]]] = {}
    blocked_days: dict[str, set[int]] = {}
    for level_id, arms in arms_by_level.items():
        groups: dict[str, list[ExamSubjectPayload]] = {}
        for subject in arms[0].subjects:
            groups.setdefault(group_key(subject), []).append(subject)
        level_groups[level_id] = groups
        # A day where any arm of this level already has a (non-rejected)
        # paper is left alone entirely — slot times on a shared grid can't be
        # reconciled with an arbitrary existing paper's times.
        blocked_days[level_id] = {
            i for i, d in enumerate(days) if any((e := a.existingByDate.get(d)) and e.count > 0 for a in arms)
        }

    x: dict[tuple[str, str, int, int], Any] = {}
    for level_id, groups in level_groups.items():
        for key in groups:
            last_days_only = any(m.lastDaysOnly for m in groups[key])
            # FIRST_PAPER_SUBJECTS only ever get slot 0 — which also caps them
            # at one per day, since a slot holds one paper per level.
            first_paper = any(m.firstPaper for m in groups[key])
            # AFTERNOON_SUBJECTS never get slot 0.
            afternoon = not first_paper and any(m.afternoon for m in groups[key])
            for d in range(day_count):
                if d in blocked_days[level_id]:
                    continue
                if last_days_only and d < day_count - last_days_window:
                    continue
                for k in range(1 if afternoon else 0, 1 if first_paper else slots_per_day):
                    x[(level_id, key, d, k)] = model.new_bool_var(f"x_{level_id}_{key}_{d}_{k}")

    def is_calc(level_id: str, key: str) -> bool:
        return any(m.requiresCalculation for m in level_groups[level_id][key])

    for level_id, groups in level_groups.items():
        for key in groups:
            vars_ = [v for (lv, g, _d, _k), v in x.items() if lv == level_id and g == key]
            if not vars_:
                return f"No open exam day left for a subject in class level {level_id}"
            model.add(sum(vars_) == 1)
        for d in range(day_count):
            for k in range(slots_per_day):
                slot_vars = [x[(level_id, g, d, k)] for g in groups if (level_id, g, d, k) in x]
                if len(slot_vars) > 1:
                    model.add(sum(slot_vars) <= 1)
            if spread_calc:
                calc_vars = [
                    x[(level_id, g, d, k)]
                    for g in groups
                    if is_calc(level_id, g)
                    for k in range(slots_per_day)
                    if (level_id, g, d, k) in x
                ]
                if len(calc_vars) > 1:
                    model.add(sum(calc_vars) <= 1)

        calc_keys = [g for g in groups if is_calc(level_id, g)]
        if min_gap > 0 and len(calc_keys) > 1:
            day_of = {
                g: sum(d * v for (lv, gg, d, _k), v in x.items() if lv == level_id and gg == g) for g in calc_keys
            }
            for i in range(len(calc_keys)):
                for j in range(i + 1, len(calc_keys)):
                    a, b = calc_keys[i], calc_keys[j]
                    before = model.new_bool_var(f"before_{level_id}_{a}_{b}")
                    model.add(day_of[b] - day_of[a] >= min_gap).only_enforce_if(before)
                    model.add(day_of[a] - day_of[b] >= min_gap).only_enforce_if(before.Not())

    objective_terms = []
    # Packing: earlier days first, then earlier slots.
    for (_lv, _g, d, k), v in x.items():
        objective_terms.append((d * slots_per_day + k) * v)
        if not _day_allowed(level_groups[_lv][_g], days[d], first_dates):
            objective_terms.append(OFF_WEEKDAY_PENALTY * v)

    # SPREAD_PAPERS_ACROSS_DAYS: every level sits at least one paper a day,
    # as evenly as its paper count allows, its papers filling the day's slots
    # from the first one — so a lighter day's free slots are its last.
    if spread:
        for level_id, groups in level_groups.items():
            loads: list[Any] = []
            for d in range(day_count):
                slot_loads = [
                    [x[(level_id, g, d, k)] for g in groups if (level_id, g, d, k) in x] for k in range(slots_per_day)
                ]
                for k in range(1, slots_per_day):
                    if slot_loads[k]:
                        model.add(sum(slot_loads[k]) <= sum(slot_loads[k - 1]))
                day_vars = [v for slot in slot_loads for v in slot]
                loads.append(sum(day_vars) if day_vars else 0)
            objective_terms.extend(_spread_terms(model, loads, slots_per_day, level_id))

    # ALIGN_CLASS_LEVELS (hard): ClassLevels of one alignment group (their
    # category) sit every paper (bundle) they share in the identical slot —
    # all JSS classes write Mathematics together, all SSS classes their
    # Physics/Accounts/Literature column together. Papers only some levels
    # have stay free.
    if align_class_levels:
        levels_by_group: dict[str, list[str]] = {}
        for level_id, arms in arms_by_level.items():
            if arms[0].alignmentGroup:
                levels_by_group.setdefault(arms[0].alignmentGroup, []).append(level_id)
        for level_ids in levels_by_group.values():
            for i, a in enumerate(level_ids):
                for b in level_ids[i + 1 :]:
                    for key in set(level_groups[a]) & set(level_groups[b]):
                        for d in range(day_count):
                            for k in range(slots_per_day):
                                va, vb = x.get((a, key, d, k)), x.get((b, key, d, k))
                                if va is not None and vb is not None:
                                    model.add(va == vb)
                                elif va is not None:
                                    model.add(va == 0)
                                elif vb is not None:
                                    model.add(vb == 0)

    # AFTERNOON_SUBJECTS: nothing of the same level sits in a later slot of
    # that day (slot 0 is already excluded above).
    for (lv, g, d, k), v in x.items():
        if not any(m.afternoon for m in level_groups[lv][g]) or any(m.firstPaper for m in level_groups[lv][g]):
            continue
        later = [w for (lv2, g2, d2, k2), w in x.items() if lv2 == lv and d2 == d and k2 > k and g2 != g]
        if later:
            model.add(sum(later) == 0).only_enforce_if(v)

    # MIN_PAPERS_PER_DAY / MAX_DAILY_PAPER_DIFFERENCE (hard). A day already
    # holding this level's papers (blocked_days) counts at that existing load.
    if daily and daily.active:
        for level_id in level_groups:
            hard_loads: list[Any] = []
            for d in range(day_count):
                day_vars = [v for (lv, _g, dd, _k), v in x.items() if lv == level_id and dd == d]
                if day_vars:
                    hard_loads.append(sum(day_vars))
                else:
                    hard_loads.append(
                        max((e.count for a in arms_by_level[level_id] if (e := a.existingByDate.get(days[d]))), default=0)
                    )
            _add_daily_limits(model, hard_loads, slots_per_day, daily, f"u_{level_id}")

    # CALCULATION_SUBJECTS_MORNING: a calculation paper belongs in the day's
    # first slot (soft, so a day with two calculation papers — only possible
    # with SPREAD_CALCULATION_SUBJECTS off — still solves).
    if calculation_subjects_morning:
        for (lv, g, _d, k), v in x.items():
            if k > 0 and is_calc(lv, g):
                objective_terms.append(CALC_NOT_FIRST_PENALTY * v)

    # Cross-level alignment for un-bundled subjects shared by 2+ levels:
    # y[s, d, k] is "subject s is sat in (d, k) by someone"; minimizing the
    # number of distinct (d, k) each subject uses pulls the levels together.
    levels_by_subject: dict[str, list[str]] = {}
    for level_id, groups in level_groups.items():
        for key, members in groups.items():
            if len(members) == 1 and members[0].concurrencyGroupId is None:
                levels_by_subject.setdefault(key, []).append(level_id)
    for subject_id, level_ids in levels_by_subject.items():
        if len(level_ids) < 2:
            continue
        for d in range(day_count):
            for k in range(slots_per_day):
                level_vars = [x[(lv, subject_id, d, k)] for lv in level_ids if (lv, subject_id, d, k) in x]
                if not level_vars:
                    continue
                used = model.new_bool_var(f"used_{subject_id}_{d}_{k}")
                for v in level_vars:
                    model.add_implication(v, used)
                objective_terms.append(CROSS_LEVEL_MISALIGN_PENALTY * used)

    model.minimize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = UNIFIED_SOLVE_TIME_LIMIT_SECONDS
    solver.parameters.num_workers = 8
    status = solver.solve(model)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return "No feasible combined exam timetable found for this sitting"

    day_start = _time_to_minutes(exam_day_start_time)
    rows: list[dict[str, Any]] = []
    for (level_id, key, d, k), v in x.items():
        if not solver.value(v):
            continue
        slot_start = day_start + _slot_offset(k, slot_length, exam_break)
        for arm in arms_by_level[level_id]:
            for member in level_groups[level_id][key]:
                duration = calc_duration if member.requiresCalculation else non_calc_duration
                rows.append(
                    {
                        "classArmId": arm.classArmId,
                        "assessmentComponentId": arm.assessmentComponentId,
                        "subjectId": member.subjectId,
                        "date": days[d],
                        "startTime": _minutes_to_time(slot_start),
                        "endTime": _minutes_to_time(slot_start + duration),
                    }
                )
    return rows


def _slot_offset(k: int, slot_length: int, exam_break: tuple[int, int] | None) -> int:
    """Minutes from the exam-day start to slot k on a unified grid — the break sits after slot exam_break[0] - 1."""
    offset = k * slot_length
    if exam_break and k >= exam_break[0]:
        offset += exam_break[1]
    return offset


def _time_to_minutes(t: str) -> int:
    h, m = t.split(":")
    return int(h) * 60 + int(m)


def _window_minutes(start: str, end: str | None) -> int | None:
    if not end:
        return None
    return max(0, _time_to_minutes(end) - _time_to_minutes(start))


def _minutes_to_time(total_minutes: int) -> str:
    hours = (total_minutes // 60) % 24
    minutes = total_minutes % 60
    return f"{hours:02d}:{minutes:02d}"

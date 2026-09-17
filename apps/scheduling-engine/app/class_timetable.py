"""
BUILD_PLAN.md §9 Step 2: the real CP-SAT model for `scope=CLASS_TIMETABLE`.

This service holds no DB credentials (ARCHITECTURE.md §9), so apps/worker's
SchedulingSolveDispatchProcessor pre-resolves everything needed into the
payload: per-group period structure, each class arm's required subjects
(with their assigned teacher and weekly frequency), and which periods are
already blocked (by an existing TimetableSlot) per class arm and per staff
member. This module's only job is the pure combinatorial assignment problem
plus converting each assigned (day, period) into an actual clock time.
"""

from typing import Any

from ortools.sat.python import cp_model
from pydantic import BaseModel


class SubjectPayload(BaseModel):
    subjectId: str
    # Display-only (error messages) — never used for matching/solving, that's
    # all subjectId. Lets an infeasibility reason name the actual subject
    # instead of an opaque id.
    subjectName: str
    staffId: str
    periodsPerWeek: int
    requiresCalculation: bool
    # "Options column" membership (ClassSubjectConcurrencyGroup) — subjects
    # sharing this id are mutually exclusive per student (e.g. SSS's
    # Physics/Financial Accounting/Literature in English), so they're
    # scheduled at the exact same (day, period) instead of each reserving
    # separate weekly capacity. None means "not part of a bundle."
    concurrencyGroupId: str | None = None
    # Hard constraint (SUBJECT_ALLOWED_DAYS, apps/worker resolves this per
    # Subject.name) — None/empty means "any day," today's default. When set,
    # this subject can ONLY be scheduled on one of these days, so
    # `periodsPerWeek` must fit within them (checked the same "not enough
    # open slots" way as every other blocked-period source).
    allowedDays: list[str] | None = None
    # Soft preference (SUBJECT_PREFER_MORNING) — no hard restriction, but the
    # solver's objective rewards placing this subject's occurrences at or
    # before breakAfterPeriod (the same morning/afternoon split
    # CALCULATION_SUBJECTS_MORNING already uses as a HARD cutoff for
    # requiresCalculation subjects).
    preferMorning: bool = False
    # Soft preference (SUBJECT_PREFER_AFTERNOON) — the mirror image of
    # preferMorning: rewards placing this subject's occurrences strictly
    # after breakAfterPeriod instead of at/before it.
    preferAfternoon: bool = False
    # SYNC_ALL_SUBJECTS_CLASS_LEVEL_NAMES/SYNC_ALL_SUBJECTS_EXCLUDED_SUBJECT_NAMES
    # — apps/worker resolves this entirely by Subject.name/ClassLevel.name
    # (case/whitespace-insensitively) and periodsPerWeek-consistency BEFORE
    # this payload is built; never matched here, matching this file's
    # existing "subjectName stays display-only" convention. When set, every
    # SubjectPayload across every arm sharing the identical string is
    # scheduled independently (its OWN variable, not a shared one — see the
    # bundles loop's comment for why) but REWARDED for landing on the same
    # (day, period) as its sync-mates (see sync_reward_terms below) — a soft
    # preference, not a hard requirement, precisely so one arm being
    # unavailable (e.g. off with French/Music/Phonics's shared specialist)
    # never blocks every OTHER arm from independently using that slot too.
    # None means "no alignment reward," today's behavior for every subject
    # that isn't pooled or is explicitly excluded.
    wholeLevelSyncKey: str | None = None
    # LAST_PERIOD_BLOCK_SUBJECT_COUNTS (apps/worker resolves this per
    # Subject.name, same convention as allowedDays/preferMorning). > 0 means
    # exactly this many of this subject's periodsPerWeek occurrences must
    # fall within GroupPayload's reserved block (lastPeriodBlockDays x
    # lastPeriodBlockPeriods) — its remaining occurrences, if any, are
    # otherwise unrestricted. 0 (the default) means this subject is
    # hard-BANNED from that block entirely, making the block exclusive to
    # only the subjects a school has explicitly named — see is_open() and
    # the periodBlockRequiredCount constraint loop below.
    periodBlockRequiredCount: int = 0
    # SUBJECT_MAX_CONCURRENT_ARMS (apps/worker resolves this per
    # Subject.name, same convention as allowedDays/preferMorning). 1 (the
    # default) is today's behavior — this subject's one staffId can never be
    # in two places at once, enforced by the staff_keys constraint below. A
    # school can raise this for a subject taught by a single specialist
    # shared across many arms of a whole-level sync pool (Music/French are
    # the motivating case): with periods reserved elsewhere for the
    # LAST_PERIOD_BLOCK_* subjects, a specialist confined to one or two
    # allowedDays may not have enough distinct slots to visit every arm
    # separately, so this lets up to N arms combine into one shared session
    # with that same teacher at the same (day, period) instead of each
    # requiring its own separate slot.
    maxConcurrentArms: int = 1


class ClassArmPayload(BaseModel):
    classArmId: str
    # Display-only (error messages), e.g. "RECEPTION 1 DIAMOND" — same
    # `${classLevel.name} ${arm.name}` convention as apps/api's withDisplayName.
    classArmDisplayName: str
    # Lets _solve_group key a synced elective-block bundle (see
    # GroupPayload.syncedElectiveClassLevelIds) by ClassLevel instead of
    # ClassArm.
    classLevelId: str
    subjects: list[SubjectPayload]
    blockedPeriods: dict[str, list[int]]


class GroupPayload(BaseModel):
    group: str
    periodsPerDay: int
    periodDurationMinutes: int
    schoolDayStartTime: str
    breakAfterPeriod: int
    breakDurationMinutes: int
    fridayBreakDurationMinutes: int
    # Second, shorter break later in the day — never applied on Friday (see
    # _compute_period_time). apps/worker's resolvePeriodStructure defaults
    # shortBreakAfterPeriod to periodsPerDay (never triggers) and
    # shortBreakDurationMinutes to 0 when a school hasn't configured these.
    shortBreakAfterPeriod: int
    shortBreakDurationMinutes: int
    # Friday's own (possibly shorter) period length and day length — default
    # to periodDurationMinutes/periodsPerDay respectively when unset, so
    # Friday behaves like every other day until a school opts in.
    fridayPeriodDurationMinutes: int
    fridayPeriodsPerDay: int
    days: list[str]
    classArms: list[ClassArmPayload]
    staffBlockedPeriods: dict[str, dict[str, list[int]]]
    # ClassLevel ids whose concurrency-group ("elective block") members
    # should share one slot across EVERY arm of that ClassLevel, not just
    # within each arm — apps/worker only ever populates this with SSS
    # ClassLevels at or under SYNC_SSS_ELECTIVE_BLOCKS_MAX_ARM_COUNT arms.
    # Empty list = today's per-arm-independent behavior for every arm.
    syncedElectiveClassLevelIds: list[str] = []
    # LAST_PERIOD_BLOCK_DAYS x LAST_PERIOD_BLOCK_PERIODS — the reserved
    # "exclusive block" of (day, period) slots (e.g. the last two periods of
    # Monday-Thursday) that only subjects with periodBlockRequiredCount > 0
    # may use. Either list empty disables the whole mechanism (today's
    # behavior, no block reserved) — see is_open() and the
    # periodBlockRequiredCount constraint loop below.
    lastPeriodBlockDays: list[str] = []
    lastPeriodBlockPeriods: list[int] = []


# Higher than the other three solvers' (exam_timetable/invigilation/
# weekly_duty) 20s default — this is the only one with a `maximize()`
# objective doing real work at real scale (SYNC_MATCH_WEIGHT's per-pool
# anchor-matching reward adds thousands of extra reified-AND variables/
# constraints for a school with several whole-level sync pools — see
# resolveWholeLevelSyncKeys), so it routinely uses its FULL time budget
# searching for a better-aligned arrangement rather than stopping at the
# first feasible one, unlike a plain feasibility search. A request this
# solve serves is fire-and-forget from the worker's side (main.py's
# BackgroundTasks — the HTTP call back to apps/worker only ever waits for
# the initial 202, never for the solve itself), so there's no outer timeout
# this needs to fit under.
SOLVE_TIME_LIMIT_SECONDS = 60.0


def solve_class_timetable(
    request_id: str,
    callback_token: str,
    calculation_subjects_morning: bool,
    groups: list[GroupPayload],
) -> dict[str, Any]:
    generated_rows: list[dict[str, Any]] = []
    # staffId -> (day, startTime, endTime) rows already assigned by an
    # EARLIER group's solve in this same run. Each group is solved as its own
    # independent CP-SAT model (_solve_group has no visibility into any other
    # group's variables), so a staff member holding an active SUBJECT_TEACHER
    # assignment in more than one group (e.g. a Primary AND JSS teacher) could
    # be placed at an overlapping time in each — invisible to either model —
    # until the callback controller's belt-and-suspenders assertNoConflicts
    # caught it and rolled back the WHOLE batch, including groups that had no
    # conflict. Feeding each group's own results forward as real time-range
    # blocks for the next group closes that gap the same way an already-
    # persisted TimetableSlot already blocks a staff member's periods.
    cross_group_staff_ranges: dict[str, list[tuple[str, str, str]]] = {}
    for group in groups:
        augmented_group = _augment_with_cross_group_blocks(group, cross_group_staff_ranges)
        rows, failure_reason = _solve_group(augmented_group, calculation_subjects_morning)
        if rows is None:
            return {
                "callbackToken": callback_token,
                "error": (
                    f"No feasible class timetable found for group {group.group} "
                    f"(requestId={request_id}): {failure_reason}"
                ),
            }
        generated_rows.extend(rows)
        for row in rows:
            cross_group_staff_ranges.setdefault(row["staffId"], []).append(
                (row["dayOfWeek"], row["startTime"], row["endTime"])
            )

    return {"callbackToken": callback_token, "result": {"generatedRows": generated_rows}}


def _time_ranges_overlap(a_start: str, a_end: str, b_start: str, b_end: str) -> bool:
    """
    Mirrors packages/types/src/scheduling.ts's `timeRangesOverlap` — same
    minutes-since-midnight comparison, computed independently on this side of
    the language boundary.
    """

    def to_minutes(time: str) -> int:
        hours, minutes = (int(part) for part in time.split(":"))
        return hours * 60 + minutes

    return to_minutes(a_start) < to_minutes(b_end) and to_minutes(b_start) < to_minutes(a_end)


def _augment_with_cross_group_blocks(
    group: GroupPayload, cross_group_staff_ranges: dict[str, list[tuple[str, str, str]]]
) -> GroupPayload:
    """
    Merges an earlier group's already-assigned rows into this group's own
    staffBlockedPeriods, for any staff member this group also uses — same
    real-time overlap check apps/worker's computeBlockedPeriods runs against a
    persisted TimetableSlot, just against an in-flight (not yet persisted) row
    from earlier in this same solve.
    """
    staff_ids_in_group = {subject.staffId for arm in group.classArms for subject in arm.subjects}
    relevant = {
        staff_id: ranges
        for staff_id, ranges in cross_group_staff_ranges.items()
        if staff_id in staff_ids_in_group
    }
    if not relevant:
        return group

    merged_blocked: dict[str, dict[str, list[int]]] = {
        staff_id: {day: list(periods) for day, periods in by_day.items()}
        for staff_id, by_day in group.staffBlockedPeriods.items()
    }
    for staff_id, ranges in relevant.items():
        by_day: dict[str, set[int]] = {
            day: set(periods) for day, periods in merged_blocked.get(staff_id, {}).items()
        }
        for day, start_time, end_time in ranges:
            day_periods = by_day.setdefault(day, set())
            count = group.fridayPeriodsPerDay if day == "FRIDAY" else group.periodsPerDay
            for period in range(1, count + 1):
                period_start, period_end = _compute_period_time(group, day, period)
                if _time_ranges_overlap(period_start, period_end, start_time, end_time):
                    day_periods.add(period)
        merged_blocked[staff_id] = {day: sorted(periods) for day, periods in by_day.items()}

    return group.model_copy(update={"staffBlockedPeriods": merged_blocked})


def _solve_group(
    group: GroupPayload,
    calculation_subjects_morning: bool,
) -> tuple[list[dict[str, Any]] | None, str | None]:
    """Returns (rows, None) on success, or (None, human-readable reason) on failure."""
    model = cp_model.CpModel()

    def periods_for_day(day: str) -> range:
        # Friday may run a shorter day (fewer periods) than the rest of the
        # week — see GroupPayload.fridayPeriodsPerDay.
        count = group.fridayPeriodsPerDay if day == "FRIDAY" else group.periodsPerDay
        return range(1, count + 1)

    staff_by_arm_subject: dict[tuple[str, str], str] = {}
    subject_by_arm_id: dict[tuple[str, str], SubjectPayload] = {}
    variables: dict[tuple[str, str, str, int], Any] = {}

    def is_open(
        arm_blocked: dict[str, set[int]], arm_has_block_subject: bool, subject: SubjectPayload, day: str, period: int
    ) -> bool:
        staff_blocked_raw = group.staffBlockedPeriods.get(subject.staffId, {})
        blocked_here = arm_blocked.get(day, set()) | set(staff_blocked_raw.get(day, []))
        if period in blocked_here:
            return False
        if subject.allowedDays and day not in subject.allowedDays:
            return False
        # LAST_PERIOD_BLOCK_* — this (day, period) is reserved exclusively
        # for subjects with periodBlockRequiredCount > 0; every other
        # subject in the SAME arm is banned from it outright, regardless of
        # any other availability it would otherwise have. Gated on
        # arm_has_block_subject: an arm whose own curriculum has NO subject
        # configured for this block at all (e.g. Nursery/Reception, when the
        # block was only ever meant for Basic's Math/Verbal/Quant/Lit/
        # Comprehension) has nothing to reserve the slot FOR, so banning it
        # anyway would just delete capacity that arm's own dense curriculum
        # needs — confirmed by testing Nursery 1/2 alone, each infeasible on
        # its own once the block ate 8 of their weekly slots for no gain.
        if (
            arm_has_block_subject
            and group.lastPeriodBlockDays
            and group.lastPeriodBlockPeriods
            and day in group.lastPeriodBlockDays
            and period in group.lastPeriodBlockPeriods
            and subject.periodBlockRequiredCount <= 0
        ):
            return False
        return not (calculation_subjects_morning and subject.requiresCalculation and period > group.breakAfterPeriod)

    arm_blocked_by_id: dict[str, dict[str, set[int]]] = {}
    arm_has_block_subject_by_id: dict[str, bool] = {}
    for arm in group.classArms:
        arm_blocked_by_id[arm.classArmId] = {day: set(periods_) for day, periods_ in arm.blockedPeriods.items()}
        arm_has_block_subject_by_id[arm.classArmId] = any(s.periodBlockRequiredCount > 0 for s in arm.subjects)
        for subject in arm.subjects:
            staff_by_arm_subject[(arm.classArmId, subject.subjectId)] = subject.staffId
            subject_by_arm_id[(arm.classArmId, subject.subjectId)] = subject

    # Group subjects into "options column" bundles — an ungrouped subject is
    # its own singleton bundle (keyed by its own id). Bundles normally key by
    # (arm, group_key) so each arm chooses its own slot independently. Two
    # separate mechanisms can instead pool every matching member into ONE
    # bundle so they're forced onto the exact same slot:
    #   - syncedElectiveClassLevelIds: keys by (classLevel, group_key) — only
    #     a real concurrency-group's members (e.g. SSS's Physics/Financial
    #     Accounting/Literature), pooled across every arm of ONE ClassLevel.
    #     A singleton (non-concurrency-group) subject stays keyed per-arm
    #     even on one of these ClassLevels — there's nothing to align it
    #     with.
    # wholeLevelSyncKey (apps/worker's resolveWholeLevelSyncKeys) is
    # deliberately NOT handled here as a third hard-shared-variable case —
    # unlike a real concurrency-group bundle (physically one combined
    # session), whole-level sync only wants "every arm's own class teacher
    # happens to teach this at the same time as their sibling arms," which
    # is a nice-to-have, not a physical requirement. Forcing it via one
    # shared variable (this codebase's first attempt) meant the ENTIRE pool
    # became unusable at any slot where even ONE member arm was blocked —
    # e.g. by a subject like French/Music/Phonics whose one shared
    # specialist teacher visits each arm at a staggered, different time —
    # which left every OTHER (individually free) arm sitting idle too,
    # instead of independently getting on with something else. Every
    # wholeLevelSyncKey subject therefore falls through to the plain
    # per-arm `else` branch below (its own independent variable, exactly
    # like an ungrouped subject) — cross-arm alignment is instead
    # encouraged, not required, via the soft `sync_reward_terms` objective
    # built after the bundles loop.
    bundles: dict[str, list[tuple[str, SubjectPayload]]] = {}
    for arm in group.classArms:
        for subject in arm.subjects:
            group_key = subject.concurrencyGroupId or subject.subjectId
            is_synced_elective = subject.concurrencyGroupId is not None and arm.classLevelId in group.syncedElectiveClassLevelIds
            if is_synced_elective:
                bundle_key = f"level:{arm.classLevelId}:{group_key}"
            else:
                bundle_key = f"arm:{arm.classArmId}:{group_key}"
            bundles.setdefault(bundle_key, []).append((arm.classArmId, subject))

    # A bundle forces every member onto the IDENTICAL (day, period) via one
    # shared variable — meaning is_open()'s teacher-availability check aside,
    # nothing so far stops two DIFFERENT subjects in the same bundle from
    # being taught by the SAME staff member, which is physically impossible
    # (one person can't deliver two different lessons in the same period).
    # The same staff member repeating the SAME subject across synced arms
    # (one teacher, one combined session) is fine — that's what the
    # staff_keys dedupe below already allows — so only split out a member
    # when its staffId collides with an EARLIER member's staffId under a
    # DIFFERENT subjectId. ClassSubjectConcurrencyGroup/StaffAssignment data
    # can end up in this state (e.g. one teacher covering two of a small
    # department's elective options); rather than building a bundle no
    # solution can satisfy without double-booking that teacher, the offending
    # member is pulled back out into its own independent singleton bundle so
    # it's scheduled at its own slot instead of forced in lockstep with a
    # subject the same teacher can't simultaneously deliver.
    for bundle_key in list(bundles.keys()):
        members = bundles[bundle_key]
        first_subject_by_staff: dict[str, str] = {}
        kept: list[tuple[str, SubjectPayload]] = []
        for arm_id, subject in members:
            prior_subject_id = first_subject_by_staff.get(subject.staffId)
            if prior_subject_id is not None and prior_subject_id != subject.subjectId:
                bundles[f"conflict:{bundle_key}:{arm_id}:{subject.subjectId}"] = [(arm_id, subject)]
                continue
            first_subject_by_staff[subject.staffId] = subject.subjectId
            kept.append((arm_id, subject))
        bundles[bundle_key] = kept

    for bundle_key, members in bundles.items():
        for day in group.days:
            for period in periods_for_day(day):
                # A bundle only gets a slot when it's open for EVERY member
                # (arm-blocked ∪ that member's own staff-blocked ∪ the
                # calc-morning restriction, whichever member(s) require it,
                # each checked against ITS OWN arm's blocked periods) —
                # otherwise one member would end up with no variable at that
                # slot while its bundle-mates did.
                if not all(
                    is_open(arm_blocked_by_id[arm_id], arm_has_block_subject_by_id[arm_id], subject, day, period)
                    for arm_id, subject in members
                ):
                    continue
                # Every member points at the SAME BoolVar object rather than
                # each getting its own — this is what forces bundle-mates
                # onto the identical slot with zero extra constraints: every
                # per-subject constraint below (periodsPerWeek sum, per-day
                # cap, teacher conflict) already reads
                # variables[(arm, subject, day, period)] on its own, so
                # sharing the object keeps them all in lockstep.
                shared_var = model.new_bool_var(f"x_{bundle_key}_{day}_{period}")
                for arm_id, subject in members:
                    variables[(arm_id, subject.subjectId, day, period)] = shared_var

    # At most one subject (or, for a bundle, one shared slot) per class arm
    # per period — deduped by concurrencyGroupId so an N-member bundle counts
    # once rather than N times. Without the dedupe, summing the identical
    # shared variable N times would force it to always be 0 (N·v ≤ 1 with
    # boolean v means v can't be 1 once N > 1), making every bundle unusable.
    for arm in group.classArms:
        for day in group.days:
            for period in periods_for_day(day):
                seen_groups: set[str] = set()
                vars_here = []
                for (arm_id, subject_id, d, p), v in variables.items():
                    if arm_id != arm.classArmId or d != day or p != period:
                        continue
                    subject = subject_by_arm_id[(arm_id, subject_id)]
                    group_key = subject.concurrencyGroupId or subject_id
                    if group_key in seen_groups:
                        continue
                    seen_groups.add(group_key)
                    vars_here.append(v)
                if vars_here:
                    model.add(sum(vars_here) <= 1)

    # Exactly periodsPerWeek occurrences per (arm, subject), spread as evenly
    # as the week allows: at most ceil(periodsPerWeek / len(days)) per day,
    # e.g. 1/day for periodsPerWeek<=5 (today's original "once/day" behavior,
    # unchanged), 2/day for a 6-periods/week subject over a 5-day week (the
    # smallest per-day cap that still admits a solution) — a subject with
    # more weekly periods than the week has days would otherwise be
    # structurally unsolvable no matter how much capacity/staffing exists.
    for arm in group.classArms:
        for subject in arm.subjects:
            subject_vars = [
                v for (arm_id, subject_id, _d, _p), v in variables.items() if arm_id == arm.classArmId and subject_id == subject.subjectId
            ]
            if len(subject_vars) < subject.periodsPerWeek:
                # Not enough open (unblocked, in-window) slots exist even in
                # principle — fail fast rather than build a model already
                # known to be infeasible. By far the most common/diagnosable
                # failure (a periodsPerWeek/SUBJECT_ALLOWED_DAYS/blocked-period
                # mismatch), so it gets a specific, actionable reason instead
                # of the generic INFEASIBLE message below.
                allowed_note = f" (restricted to {', '.join(subject.allowedDays)})" if subject.allowedDays else ""
                return None, (
                    f'"{subject.subjectName}" in {arm.classArmDisplayName} needs '
                    f"{subject.periodsPerWeek} period(s)/week but only {len(subject_vars)} "
                    f"open slot(s) are available{allowed_note} — check blocked periods, "
                    f"SUBJECT_ALLOWED_DAYS, teacher availability, or this subject's "
                    f"periods/week."
                )
            model.add(sum(subject_vars) == subject.periodsPerWeek)

            # ceil(periodsPerWeek / the days it can actually land on) — the
            # allowed-day subset when SUBJECT_ALLOWED_DAYS restricts this
            # subject, otherwise the whole week, MINUS Friday when it runs a
            # genuinely shorter day (fridayPeriodsPerDay < periodsPerDay).
            # An unrestricted subject counting Friday at full nominal weight
            # can be squeezed out by OTHER subjects hard-restricted TO that
            # short Friday (e.g. CREATIVE WRITING/SPELLING's Friday-only
            # requirement can fully consume its handful of open periods):
            # a 5-period/week subject capped at exactly 1/day over a nominal
            # 5-day week has zero slack once Friday's own slots are already
            # spoken for elsewhere, even though Monday-Thursday alone was
            # never really its bottleneck. Excluding a short Friday from the
            # denominator gives such a subject a per-day cap based on the
            # week's FULL days only, while still letting it land on Friday
            # opportunistically if room happens to be there — this only
            # loosens the cap, never forces or forbids anything, so it can't
            # make an already-feasible arrangement infeasible.
            has_short_friday = "FRIDAY" in group.days and group.fridayPeriodsPerDay < group.periodsPerDay
            if subject.allowedDays:
                eligible_day_count = len(subject.allowedDays)
            elif has_short_friday:
                eligible_day_count = max(1, len(group.days) - 1)
            else:
                eligible_day_count = len(group.days)
            max_per_day = max(1, -(-subject.periodsPerWeek // eligible_day_count))  # ceil division
            for day in group.days:
                day_vars = [
                    v
                    for (arm_id, subject_id, d, _p), v in variables.items()
                    if arm_id == arm.classArmId and subject_id == subject.subjectId and d == day
                ]
                if day_vars:
                    model.add(sum(day_vars) <= max_per_day)

            # LAST_PERIOD_BLOCK_SUBJECT_COUNTS — exactly this many of this
            # subject's periodsPerWeek occurrences must land within the
            # reserved block (is_open() has already banned every OTHER
            # subject from it entirely, making it exclusive). The remaining
            # `periodsPerWeek - periodBlockRequiredCount` occurrences (if
            # any) are covered by the plain `sum(subject_vars) ==
            # periodsPerWeek` constraint above and land wherever the solver
            # finds room outside the block — no extra constraint needed for
            # those, the arithmetic already forces it.
            if subject.periodBlockRequiredCount > 0:
                block_vars = [
                    v
                    for (arm_id, subject_id, d, p), v in variables.items()
                    if arm_id == arm.classArmId
                    and subject_id == subject.subjectId
                    and d in group.lastPeriodBlockDays
                    and p in group.lastPeriodBlockPeriods
                ]
                if len(block_vars) < subject.periodBlockRequiredCount:
                    return None, (
                        f'"{subject.subjectName}" in {arm.classArmDisplayName} needs '
                        f"{subject.periodBlockRequiredCount} period(s) in the reserved block "
                        f"({', '.join(group.lastPeriodBlockDays)} period(s) "
                        f"{', '.join(str(p) for p in group.lastPeriodBlockPeriods)}) but only "
                        f"{len(block_vars)} slot(s) are available there — check blocked periods "
                        f"or teacher availability for that block."
                    )
                model.add(sum(block_vars) == subject.periodBlockRequiredCount)

    # No teacher double-booked across class arms within this solve, except up
    # to a subject's own maxConcurrentArms (SUBJECT_MAX_CONCURRENT_ARMS — see
    # SubjectPayload.maxConcurrentArms). Grouped first by staffId, then by
    # subjectId: two arms taught the SAME subject by the SAME staff member
    # may share a slot, up to that subject's cap — letting one specialist
    # combine several arms into a single physical session when the week
    # doesn't have enough distinct slots to visit each arm separately. A
    # staff member appearing at two DIFFERENT subjects at the same time is
    # never allowed regardless of any cap — that's a hard physical
    # impossibility (one person can't deliver two different lessons in two
    # different sessions simultaneously), not a capacity choice. Deduped by
    # variable identity first (not just by (arm, subject) pair) so a synced
    # elective bundle sharing one BoolVar across arms of the same ClassLevel
    # isn't double-counted against its own cap.
    staff_subject_keys: dict[str, dict[str, list[str]]] = {}
    for (arm_id, subject_id), staff_id in staff_by_arm_subject.items():
        staff_subject_keys.setdefault(staff_id, {}).setdefault(subject_id, []).append(arm_id)

    for staff_id, arms_by_subject in staff_subject_keys.items():
        if sum(len(arm_ids) for arm_ids in arms_by_subject.values()) < 2:
            continue
        for day in group.days:
            for period in periods_for_day(day):
                vars_by_subject: dict[str, list[Any]] = {}
                for subject_id, arm_ids in arms_by_subject.items():
                    seen_var_ids: set[int] = set()
                    vars_for_subject = []
                    for arm_id in arm_ids:
                        v = variables.get((arm_id, subject_id, day, period))
                        if v is None or id(v) in seen_var_ids:
                            continue
                        seen_var_ids.add(id(v))
                        vars_for_subject.append(v)
                    if vars_for_subject:
                        vars_by_subject[subject_id] = vars_for_subject

                if not vars_by_subject:
                    continue

                for subject_id, vars_for_subject in vars_by_subject.items():
                    if len(vars_for_subject) < 2:
                        continue
                    max_concurrent = subject_by_arm_id[(arms_by_subject[subject_id][0], subject_id)].maxConcurrentArms
                    model.add(sum(vars_for_subject) <= max_concurrent)

                subject_ids_here = list(vars_by_subject.keys())
                for i, subject_a in enumerate(subject_ids_here):
                    for subject_b in subject_ids_here[i + 1 :]:
                        for var_a in vars_by_subject[subject_a]:
                            for var_b in vars_by_subject[subject_b]:
                                model.add(var_a + var_b <= 1)

    # Each (arm, subject) is already capped at one occurrence/day above,
    # which is what actually spreads a calculation subject's periods across
    # the week — deliberately no additional cross-subject cap here: with
    # several calculation subjects on one arm (e.g. SSS's Math/Further
    # Maths/Physics/Chemistry/Accounting, each 3 periods/week), a "one calc
    # period per day total" cap needs more distinct calc-subject days than a
    # 5-day week has, making the model infeasible regardless of staffing.

    # Soft cross-arm alignment reward for wholeLevelSyncKey subjects (see the
    # bundles-loop comment above for why this isn't a hard shared-variable
    # constraint). One arbitrary "anchor" arm per pool key is picked — since
    # every member of a wholeLevelSyncKey bucket already has to agree on
    # periodsPerWeek (apps/worker's resolveWholeLevelSyncKeys), any member
    # works equally well as the reference every OTHER member is rewarded for
    # matching. `match_var` is a standard reified-AND (`match == anchor AND
    # other`): forced to 0 whenever either side is 0, and free to be 1 only
    # when both are — maximizing its sum therefore rewards the solver for
    # choosing the SAME (day, period) for both, without ever forbidding
    # either variable from being 1 on its own when they don't align (e.g.
    # because the anchor's arm is busy with French and this arm isn't).
    sync_key_members: dict[str, list[tuple[str, str]]] = {}
    for arm in group.classArms:
        for subject in arm.subjects:
            if subject.wholeLevelSyncKey is None:
                continue
            sync_key_members.setdefault(subject.wholeLevelSyncKey, []).append((arm.classArmId, subject.subjectId))

    sync_reward_terms: list[Any] = []
    for sync_key, members in sync_key_members.items():
        if len(members) < 2:
            continue
        anchor_arm_id, anchor_subject_id = members[0]
        for other_arm_id, other_subject_id in members[1:]:
            for day in group.days:
                for period in periods_for_day(day):
                    anchor_var = variables.get((anchor_arm_id, anchor_subject_id, day, period))
                    other_var = variables.get((other_arm_id, other_subject_id, day, period))
                    if anchor_var is None or other_var is None:
                        continue
                    match_var = model.new_bool_var(f"match_{sync_key}_{other_arm_id}_{day}_{period}")
                    model.add(match_var <= anchor_var)
                    model.add(match_var <= other_var)
                    model.add(match_var >= anchor_var + other_var - 1)
                    sync_reward_terms.append(match_var)

    # First feasible solution only (BUILD_PLAN.md §9: "a usable draft ...
    # requiring only minor manual edits", not a globally-optimized
    # timetable) — UNLESS at least one subject sets preferMorning/
    # preferAfternoon (SUBJECT_PREFER_MORNING/SUBJECT_PREFER_AFTERNOON) or a
    # wholeLevelSyncKey alignment reward exists above, in which case the
    # search maximizes a weighted sum of all three (plus the blanket
    # "no idle morning periods" reward below) instead of stopping at the
    # first feasible arrangement. Cross-arm alignment (SYNC_MATCH_WEIGHT)
    # and morning-packing (MORNING_FILL_WEIGHT, below) are weighted well
    # above per-subject morning/afternoon placement, which is comparatively
    # a minor nicety — still bounded by the same SOLVE_TIME_LIMIT_SECONDS,
    # so the solver returns its best-found FEASIBLE arrangement if it can't
    # prove OPTIMAL in time, exactly like today's plain feasibility search.
    SYNC_MATCH_WEIGHT = 5
    morning_terms: list[Any] = []
    seen_morning_var_ids: set[int] = set()
    for (arm_id, subject_id, day, period), var in variables.items():
        subject = subject_by_arm_id[(arm_id, subject_id)]
        if not subject.preferMorning or period > group.breakAfterPeriod:
            continue
        if id(var) in seen_morning_var_ids:
            continue
        seen_morning_var_ids.add(id(var))
        morning_terms.append(var)
    afternoon_terms: list[Any] = []
    seen_afternoon_var_ids: set[int] = set()
    for (arm_id, subject_id, day, period), var in variables.items():
        subject = subject_by_arm_id[(arm_id, subject_id)]
        if not subject.preferAfternoon or period <= group.breakAfterPeriod:
            continue
        if id(var) in seen_afternoon_var_ids:
            continue
        seen_afternoon_var_ids.add(id(var))
        afternoon_terms.append(var)

    # "No idle morning periods" — reward packing EVERY arm's own morning
    # slots (period <= breakAfterPeriod that survived is_open(), e.g.
    # already excluding the school-wide assembly block) with SOME subject,
    # pushing any leftover/idle capacity into the afternoon instead. Every
    # variable with period <= breakAfterPeriod counts here regardless of
    # that subject's own preferMorning/preferAfternoon flag — this is a
    # blanket "keep mornings full" preference, not a per-subject one. A
    # pure reward, not a hard "every morning slot must be filled"
    # constraint: the latter could occasionally conflict with a max-per-day
    # cap or SUBJECT_ALLOWED_DAYS in a way that makes the whole model
    # infeasible for no good reason, whereas a heavily-weighted reward
    # achieves the same outcome whenever it's actually achievable — true
    # for every arm in a curriculum whose weekly total exceeds the week's
    # morning capacity (periods <= breakAfterPeriod, per day, times 5 days),
    # which apps/worker's callers should confirm holds before relying on
    # this to fully empty out morning gaps. Weighted above SYNC_MATCH_WEIGHT
    # since an idle mid-morning period reads far worse on a printed
    # timetable than one specific subject landing at 2pm instead of 10am.
    MORNING_FILL_WEIGHT = 10
    morning_fill_terms: list[Any] = []
    seen_morning_fill_var_ids: set[int] = set()
    for (arm_id, subject_id, day, period), var in variables.items():
        if period > group.breakAfterPeriod:
            continue
        if id(var) in seen_morning_fill_var_ids:
            continue
        seen_morning_fill_var_ids.add(id(var))
        morning_fill_terms.append(var)

    if sync_reward_terms or morning_terms or afternoon_terms or morning_fill_terms:
        model.maximize(
            SYNC_MATCH_WEIGHT * sum(sync_reward_terms)
            + MORNING_FILL_WEIGHT * sum(morning_fill_terms)
            + sum(morning_terms)
            + sum(afternoon_terms)
        )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = SOLVE_TIME_LIMIT_SECONDS
    # CP-SAT's portfolio search splits work across this many threads,
    # sharing discovered bounds/solutions between them — a standard,
    # correctness-neutral speedup (never changes the search space, only how
    # fast it's explored) that matters here given the `maximize()` objective
    # above routinely uses the full time budget. 8 is a safe default even on
    # a smaller machine; OR-Tools clamps to however many cores are actually
    # available rather than erroring.
    solver.parameters.num_search_workers = 8
    status = solver.solve(model)

    if status == cp_model.INFEASIBLE:
        arm_names = ", ".join(sorted({arm.classArmDisplayName for arm in group.classArms}))
        return None, (
            f"No arrangement satisfies every constraint together across {arm_names} "
            f"— likely a teacher double-booked beyond their available periods, or "
            f"SUBJECT_ALLOWED_DAYS pinning more than one subject onto the same "
            f"limited day(s). Try loosening SUBJECT_ALLOWED_DAYS, reviewing teacher "
            f"assignments, or reducing a subject's periods/week for this group."
        )
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        # UNKNOWN (or, in principle, MODEL_INVALID) — the search neither found
        # nor ruled out a solution within the time budget, distinct from a
        # proven INFEASIBLE above: worth telling the admin a retry might
        # actually help, unlike the true-infeasible case.
        return None, (
            f"The solver could not find or rule out a solution within "
            f"{SOLVE_TIME_LIMIT_SECONDS:.0f}s — try generating again, or simplify "
            f"this group's constraints (fewer restricted subjects or class arms "
            f"per run)."
        )

    rows: list[dict[str, Any]] = []
    for (arm_id, subject_id, day, period), var in variables.items():
        if solver.value(var):
            start_time, end_time = _compute_period_time(group, day, period)
            rows.append(
                {
                    "classArmId": arm_id,
                    "subjectId": subject_id,
                    "staffId": staff_by_arm_subject[(arm_id, subject_id)],
                    "dayOfWeek": day,
                    "startTime": start_time,
                    "endTime": end_time,
                }
            )
    return rows, None


def _compute_period_time(group: GroupPayload, day: str, period_index: int) -> tuple[str, str]:
    """
    Mirrors packages/types/src/scheduling.ts's `computePeriodTime` — same
    arithmetic (including the two-break, Friday-specific-duration handling),
    computed independently here from the same seed values rather than shared
    across the language boundary. Only worker-side blocked-period computation
    uses the TypeScript version; this is what actually determines the
    persisted TimetableSlot.startTime/endTime.
    """
    is_friday = day == "FRIDAY"
    start_hour, start_minute = (int(part) for part in group.schoolDayStartTime.split(":"))
    day_start_minutes = start_hour * 60 + start_minute
    period_duration = group.fridayPeriodDurationMinutes if is_friday else group.periodDurationMinutes
    break_minutes = group.fridayBreakDurationMinutes if is_friday else group.breakDurationMinutes

    period_start_minutes = day_start_minutes + (period_index - 1) * period_duration
    if period_index > group.breakAfterPeriod:
        period_start_minutes += break_minutes
    # Never applied on Friday, even if a school's Friday day were long enough
    # to reach it — an explicit rule, not just a consequence of
    # fridayPeriodsPerDay normally stopping before then.
    if not is_friday and period_index > group.shortBreakAfterPeriod:
        period_start_minutes += group.shortBreakDurationMinutes
    period_end_minutes = period_start_minutes + period_duration

    return _minutes_to_time(period_start_minutes), _minutes_to_time(period_end_minutes)


def _minutes_to_time(total_minutes: int) -> str:
    hours = (total_minutes // 60) % 24
    minutes = total_minutes % 60
    return f"{hours:02d}:{minutes:02d}"

// Step 3: fit the smoothed core-hours curve to a shift menu.
// 5.2 full-coverage solve (upper bound) -> 5.3 budget-capped greedy trim (the actual output)
// -> 5.4 transition-hour weighting -> 5.6 department-level ENA floor check.
import type { Grid, ShiftDef, ShortfallEntry } from './types';

/** Hours (0-23) covered by one instance of a shift, circular within a single day. */
function shiftHoursOfDay(shift: ShiftDef): number[] {
  const hours: number[] = [];
  for (let i = 0; i < shift.lengthHours; i++) {
    hours.push((shift.startHour + i) % 24);
  }
  return hours;
}

function coverageForDay(headcount: Record<string, number>, shifts: ShiftDef[]): number[] {
  const coverage = new Array(24).fill(0);
  for (const shift of shifts) {
    const hc = headcount[shift.id] ?? 0;
    if (hc <= 0) continue;
    for (const h of shiftHoursOfDay(shift)) coverage[h] += hc;
  }
  return coverage;
}

/**
 * 5.2 Full-coverage solve for one day: minimum headcount per shift slot such that
 * every hour's requirement is met. Small covering problem, solved by direct greedy search:
 * repeatedly bump the shift that relieves the most currently-deficient hours.
 */
function solveFullCoverageDay(requirement: number[], shifts: ShiftDef[]): Record<string, number> {
  const headcount: Record<string, number> = {};
  for (const s of shifts) headcount[s.id] = 0;
  if (shifts.length === 0) return headcount;

  const shiftHours = new Map(shifts.map((s) => [s.id, shiftHoursOfDay(s)]));

  let coverage = coverageForDay(headcount, shifts);
  let guard = 0;
  while (guard++ < 100000) {
    let deficitHours = 0;
    for (let h = 0; h < 24; h++) if (coverage[h] < requirement[h]) deficitHours++;
    if (deficitHours === 0) break;

    let bestShiftId: string | null = null;
    let bestScore = -1;
    for (const s of shifts) {
      const hours = shiftHours.get(s.id)!;
      const score = hours.filter((h) => coverage[h] < requirement[h]).length;
      if (score > bestScore) {
        bestScore = score;
        bestShiftId = s.id;
      }
    }
    if (bestShiftId === null || bestScore <= 0) break; // no shift can help; avoid infinite loop
    headcount[bestShiftId] += 1;
    coverage = coverageForDay(headcount, shifts);
  }
  return headcount;
}

function hourWeight(hour: number, shifts: ShiftDef[], transitionWeight: number, windowHours: number): number {
  for (const s of shifts) {
    for (let w = -windowHours; w <= windowHours; w++) {
      const target = ((s.startHour + w) % 24 + 24) % 24;
      if (target === hour) return transitionWeight;
    }
  }
  return 1.0;
}

/**
 * 5.3 Budget-capped trim, run independently per day against that day's share of the weekly cap
 * (weekly cap allocated proportionally to each day's full-coverage hours), minimizing 5.4's
 * transition-weighted shortfall per hour of schedule freed.
 */
function trimDayToBudget(
  requirement: number[],
  shifts: ShiftDef[],
  fullCoverageHeadcount: Record<string, number>,
  dayCapHours: number,
  weights: number[] // per-hour weight, length 24
): Record<string, number> {
  const headcount = { ...fullCoverageHeadcount };

  const scheduledHours = () => shifts.reduce((acc, s) => acc + (headcount[s.id] ?? 0) * s.lengthHours, 0);
  const weightedDeficit = (coverage: number[]) =>
    coverage.reduce((acc, c, h) => acc + Math.max(0, requirement[h] - c) * weights[h], 0);

  let guard = 0;
  while (scheduledHours() > dayCapHours && guard++ < 100000) {
    let bestShiftId: string | null = null;
    let bestRatio = Infinity;
    const coverageNow = coverageForDay(headcount, shifts);
    const deficitNow = weightedDeficit(coverageNow);

    for (const s of shifts) {
      if ((headcount[s.id] ?? 0) <= 0) continue;
      const trial = { ...headcount, [s.id]: headcount[s.id] - 1 };
      const coverageTrial = coverageForDay(trial, shifts);
      const deficitTrial = weightedDeficit(coverageTrial);
      const addedShortfall = deficitTrial - deficitNow;
      const ratio = addedShortfall / s.lengthHours;
      if (ratio < bestRatio) {
        bestRatio = ratio;
        bestShiftId = s.id;
      }
    }
    if (bestShiftId === null) break; // nothing left to trim
    headcount[bestShiftId] -= 1;
  }
  return headcount;
}

/** 5.6: department-level floor — total on-duty headcount at any hour, summed across overlapping slots, >= floor. */
function enforceDepartmentFloor(
  grid: Grid,
  shifts: ShiftDef[],
  floor: number
): Array<{ day: number; hour: number; onDuty: number }> {
  const violationsFixed: Array<{ day: number; hour: number; onDuty: number }> = [];
  for (let day = 0; day < 7; day++) {
    const headcount = grid[day];
    let guard = 0;
    while (guard++ < 1000) {
      const coverage = coverageForDay(headcount, shifts);
      let worstHour = -1;
      let worstOnDuty = floor;
      for (let h = 0; h < 24; h++) {
        if (coverage[h] < floor && coverage[h] < worstOnDuty + 1) {
          worstHour = h;
          worstOnDuty = coverage[h];
        }
      }
      if (worstHour === -1) break;
      // bump the shift covering this hour with the largest overlap with this day's other low hours
      let bestShiftId: string | null = null;
      let bestOverlap = -1;
      for (const s of shifts) {
        const hours = shiftHoursOfDay(s);
        if (!hours.includes(worstHour)) continue;
        const overlap = hours.filter((h) => coverage[h] < floor).length;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestShiftId = s.id;
        }
      }
      if (!bestShiftId) break;
      headcount[bestShiftId] = (headcount[bestShiftId] ?? 0) + 1;
      violationsFixed.push({ day, hour: worstHour, onDuty: worstOnDuty });
    }
  }
  return violationsFixed;
}

export interface SolveResult {
  grid: Grid;
  weeklyScheduledHours: number;
  shortfall: ShortfallEntry[];
  enaFloorViolationsRemaining: Array<{ day: number; hour: number; onDuty: number }>;
}

export function solveShiftFit(
  hourlyRequirement168: number[],
  shifts: ShiftDef[],
  weeklyBudgetHours: number,
  hoursBudgetTolerance: number,
  transitionWeight: number,
  transitionWindowHours: number,
  enaFloor: number
): SolveResult {
  const capHours = weeklyBudgetHours * (1 + hoursBudgetTolerance);
  const grid: Grid = {};

  // Solve full coverage per day first (5.2), to know each day's natural share of total hours.
  const fullCoverageByDay: Record<string, number>[] = [];
  const requirementByDay: number[][] = [];
  const weightsByDay: number[][] = [];
  let totalFullCoverageHours = 0;

  for (let day = 0; day < 7; day++) {
    const requirement = hourlyRequirement168.slice(day * 24, day * 24 + 24);
    requirementByDay.push(requirement);
    const weights = requirement.map((_, h) => hourWeight(h, shifts, transitionWeight, transitionWindowHours));
    weightsByDay.push(weights);
    const full = solveFullCoverageDay(requirement, shifts);
    fullCoverageByDay.push(full);
    totalFullCoverageHours += shifts.reduce((acc, s) => acc + (full[s.id] ?? 0) * s.lengthHours, 0);
  }

  // Allocate the weekly cap across days proportional to each day's full-coverage need.
  for (let day = 0; day < 7; day++) {
    const dayFullHours = shifts.reduce(
      (acc, s) => acc + (fullCoverageByDay[day][s.id] ?? 0) * s.lengthHours,
      0
    );
    const dayCapHours =
      totalFullCoverageHours > 0 ? (dayFullHours / totalFullCoverageHours) * capHours : capHours / 7;
    grid[day] = trimDayToBudget(
      requirementByDay[day],
      shifts,
      fullCoverageByDay[day],
      dayCapHours,
      weightsByDay[day]
    );
  }

  const enaFloorViolationsRemaining = enforceDepartmentFloor(grid, shifts, enaFloor);

  const weeklyScheduledHours = Object.values(grid).reduce(
    (acc, headcount) => acc + shifts.reduce((a, s) => a + (headcount[s.id] ?? 0) * s.lengthHours, 0),
    0
  );

  const shortfall: ShortfallEntry[] = [];
  for (let day = 0; day < 7; day++) {
    const coverage = coverageForDay(grid[day], shifts);
    for (let h = 0; h < 24; h++) {
      const requirement = requirementByDay[day][h];
      if (coverage[h] < requirement) {
        shortfall.push({ day, hour: h, requirement, scheduled: coverage[h], deficit: requirement - coverage[h] });
      }
    }
  }

  return { grid, weeklyScheduledHours, shortfall, enaFloorViolationsRemaining };
}

/** Cheap live-edit recompute: pure arithmetic, no re-solve. Used when a user hand-edits a headcount cell. */
export function recomputeFromGrid(
  grid: Grid,
  shifts: ShiftDef[],
  hourlyRequirement168: number[]
): { weeklyScheduledHours: number; shortfall: ShortfallEntry[] } {
  const weeklyScheduledHours = Object.values(grid).reduce(
    (acc, headcount) => acc + shifts.reduce((a, s) => a + (headcount[s.id] ?? 0) * s.lengthHours, 0),
    0
  );
  const shortfall: ShortfallEntry[] = [];
  for (let day = 0; day < 7; day++) {
    const requirement = hourlyRequirement168.slice(day * 24, day * 24 + 24);
    const coverage = coverageForDay(grid[day] ?? {}, shifts);
    for (let h = 0; h < 24; h++) {
      if (coverage[h] < requirement[h]) {
        shortfall.push({ day, hour: h, requirement: requirement[h], scheduled: coverage[h], deficit: requirement[h] - coverage[h] });
      }
    }
  }
  return { weeklyScheduledHours, shortfall };
}

export { coverageForDay, shiftHoursOfDay };

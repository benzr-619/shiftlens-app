// Step 2: Boarding line — separate output, FTE/budget-framed, never run through the shift-fit solver.
import type { BoardingResult, Cell168 } from './types';
import { sum } from './allocate';

export function computeBoarding(
  arrivals: Cell168,
  admitRate: number | Cell168 | undefined,
  boardingDuration: Cell168 | undefined,
  boardingRatioTarget: number
): BoardingResult | null {
  // Boarding output is withheld entirely if either required input is absent — never estimated from a placeholder.
  if (admitRate === undefined || boardingDuration === undefined) return null;

  const cellBoardingRnHours = arrivals.map((a, i) => {
    const rate = typeof admitRate === 'number' ? admitRate : admitRate[i];
    const admitsThisHour = a * rate;
    const boardingCensus = admitsThisHour * boardingDuration[i];
    return boardingCensus / boardingRatioTarget;
  });

  const annualBoardingHours = sum(cellBoardingRnHours) * 52;
  const annualFte = annualBoardingHours / 2080;
  const weeklyBoardingHours = annualBoardingHours / 52;
  const weeklyFte = weeklyBoardingHours / 40;

  const perDay = [];
  for (let day = 0; day < 7; day++) {
    const dayHours = cellBoardingRnHours.slice(day * 24, day * 24 + 24);
    perDay.push({
      day,
      dailyHoldHours: sum(dayHours),
      avgConcurrentHeadcount: sum(dayHours) / 24,
      peakConcurrentHeadcount: Math.ceil(Math.max(...dayHours)),
    });
  }

  return { cellBoardingRnHours, annualBoardingHours, annualFte, weeklyBoardingHours, weeklyFte, perDay };
}

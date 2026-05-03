import type { CountryQuestion } from "../../shared/countries.js";

export interface AnswerCheckOptions {
  aliasesEnabled: boolean;
  forgivingSpellingEnabled: boolean;
  countryPool: CountryQuestion[];
}

export function normalizeAnswer(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^the\s+/i, "")
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function answerVariants(input: string): string[] {
  const normalized = normalizeAnswer(input);
  const compact = normalized.replace(/\s+/g, "");
  return compact && compact !== normalized ? [normalized, compact] : [normalized];
}

export function acceptedAnswers(country: CountryQuestion, aliasesEnabled: boolean): string[] {
  const names = [country.name, ...(aliasesEnabled ? country.aliases ?? [] : [])];
  return [...new Set(names.flatMap(answerVariants).filter(Boolean))];
}

export function isAnswerCorrect(answer: string, country: CountryQuestion, options: AnswerCheckOptions): boolean {
  const submittedVariants = answerVariants(answer);
  if (submittedVariants.length === 0 || submittedVariants[0] === "") return false;

  const exactAnswers = new Set(acceptedAnswers(country, options.aliasesEnabled));
  if (submittedVariants.some((submitted) => exactAnswers.has(submitted))) {
    return true;
  }

  if (!options.forgivingSpellingEnabled) {
    return false;
  }

  return hasSafeFuzzyMatch(submittedVariants, country, options);
}

function hasSafeFuzzyMatch(submittedVariants: string[], targetCountry: CountryQuestion, options: AnswerCheckOptions): boolean {
  const bestByCountry = new Map<string, FuzzyCandidate>();

  for (const submitted of submittedVariants) {
    for (const country of options.countryPool) {
      for (const accepted of acceptedAnswers(country, options.aliasesEnabled)) {
        const candidate = getFuzzyCandidate(country.id, submitted, accepted);
        if (!candidate) continue;

        const currentBest = bestByCountry.get(country.id);
        if (!currentBest || compareCandidates(candidate, currentBest) < 0) {
          bestByCountry.set(country.id, candidate);
        }
      }
    }
  }

  const matches = [...bestByCountry.values()].sort(compareCandidates);
  if (matches.length === 0) return false;

  const best = matches[0];
  if (best.countryId !== targetCountry.id) return false;

  // Fuzzy spelling needs one clear country-level winner. If another country is
  // close enough to be a plausible typo, reject instead of awarding the point.
  const similarlyCloseOtherCountry = matches.some((match) => {
    if (match.countryId === targetCountry.id) return false;
    return match.distance <= best.distance + 1 && match.ratio >= best.ratio - 0.08;
  });

  return !similarlyCloseOtherCountry;
}

interface FuzzyCandidate {
  countryId: string;
  distance: number;
  lengthGap: number;
  ratio: number;
}

function getFuzzyCandidate(countryId: string, submitted: string, accepted: string): FuzzyCandidate | null {
  const rule = fuzzyRule(submitted, accepted);
  if (!rule) return null;

  const distance = levenshtein(submitted, accepted);
  const ratio = similarityRatio(submitted, accepted, distance);
  const lengthGap = Math.abs(submitted.length - accepted.length);

  if (distance > rule.maxDistance || ratio < rule.minRatio || lengthGap > rule.maxLengthGap) {
    return null;
  }

  return { countryId, distance, lengthGap, ratio };
}

function fuzzyRule(
  submitted: string,
  accepted: string
): { maxDistance: number; minRatio: number; maxLengthGap: number } | null {
  const comparableLength = Math.max(submitted.length, accepted.length);
  const shortestLength = Math.min(submitted.length, accepted.length);

  if (shortestLength <= 4) return null;
  if (comparableLength <= 6) return { maxDistance: 1, minRatio: 0.83, maxLengthGap: 1 };
  if (comparableLength <= 9) return { maxDistance: 1, minRatio: 0.84, maxLengthGap: 2 };
  if (comparableLength <= 12) return { maxDistance: 2, minRatio: 0.8, maxLengthGap: 2 };
  if (comparableLength <= 16) return { maxDistance: 2, minRatio: 0.82, maxLengthGap: 3 };
  return { maxDistance: 3, minRatio: 0.82, maxLengthGap: 3 };
}

function similarityRatio(a: string, b: string, distance: number): number {
  return 1 - distance / Math.max(a.length, b.length);
}

function compareCandidates(a: FuzzyCandidate, b: FuzzyCandidate): number {
  return a.distance - b.distance || b.ratio - a.ratio || a.lengthGap - b.lengthGap;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

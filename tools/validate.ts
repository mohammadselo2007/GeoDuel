import { createRequire } from "node:module";
import { acceptedAnswers, isAnswerCorrect, normalizeAnswer } from "../server/src/answer.js";
import { COUNTRIES, COUNTRY_POOL_LABELS, type CountryQuestion } from "../shared/countries.js";
import { MICRO_COUNTRY_NAMES } from "../shared/microCountries.js";

const require = createRequire(import.meta.url);
const worldAtlas = require("world-atlas/countries-110m.json") as {
  objects: {
    countries: {
      geometries: Array<{ id?: string | number; properties?: { name?: string } }>;
    };
  };
};

const mapIds = new Set(worldAtlas.objects.countries.geometries.map((geometry) => String(geometry.id ?? "")));
const errors: string[] = [];
const requiredMicroFramingChecks = [
  "Liechtenstein",
  "Monaco",
  "Vatican City",
  "Andorra",
  "Singapore",
  "Malta",
  "Nauru"
];

assert(COUNTRIES.length === 196, `Expected 196 countries, found ${COUNTRIES.length}.`);

const ids = new Set<string>();
for (const country of COUNTRIES) {
  if (ids.has(country.id)) {
    errors.push(`Duplicate country id: ${country.id}`);
  }
  ids.add(country.id);

  if (!country.continent || country.continent === "world") {
    errors.push(`${country.name} is missing a valid continent.`);
  }

  const hasMapData = country.mapId ? mapIds.has(country.mapId) : false;
  const hasFallback = Array.isArray(country.fallbackPoint) && country.fallbackPoint.length === 2;
  if (!hasMapData && !hasFallback) {
    errors.push(`${country.name} has no map polygon and no fallback point.`);
  }
}

const acceptedAnswerOwners = new Map<string, string>();
for (const country of COUNTRIES) {
  for (const answer of acceptedAnswers(country, true)) {
    const owner = acceptedAnswerOwners.get(answer);
    if (owner && owner !== country.id) {
      errors.push(`Duplicate accepted answer "${answer}" used by ${owner} and ${country.id}.`);
    }
    acceptedAnswerOwners.set(answer, country.id);
  }
}

const byName = (name: string) => {
  const country = COUNTRIES.find((candidate) => normalizeAnswer(candidate.name) === normalizeAnswer(name));
  if (!country) throw new Error(`Test country missing: ${name}`);
  return country;
};

for (const microCountryName of MICRO_COUNTRY_NAMES) {
  const country = byName(microCountryName);
  if (!country.fallbackPoint) {
    errors.push(`${country.name} is marked as a micro country but has no fallback point for map framing.`);
  }
}

const microCountryNames = new Set<string>(MICRO_COUNTRY_NAMES.map((name) => normalizeAnswer(name)));
for (const microCountryName of requiredMicroFramingChecks) {
  const country = byName(microCountryName);
  if (!microCountryNames.has(normalizeAnswer(country.name)) || !country.fallbackPoint) {
    errors.push(`${country.name} is missing the required micro-country map framing setup.`);
  }
}

const options = {
  aliasesEnabled: true,
  forgivingSpellingEnabled: true,
  countryPool: COUNTRIES
};

const positives: Array<[string, string]> = [
  ["Untied States", "United States"],
  ["Ukrane", "Ukraine"],
  ["Australlia", "Australia"],
  ["Austrailia", "Australia"],
  ["Phillipines", "Philippines"]
];

for (const [answer, countryName] of positives) {
  assert(isAnswerCorrect(answer, byName(countryName), options), `Expected "${answer}" to match ${countryName}.`);
}

const negatives: Array<[string, string]> = [
  ["Chad", "China"],
  ["Mali", "Malta"],
  ["Iran", "Iraq"],
  ["Niger", "Nigeria"]
];

for (const [answer, countryName] of negatives) {
  assert(!isAnswerCorrect(answer, byName(countryName), options), `Expected "${answer}" not to match ${countryName}.`);
}

const ambiguousNegatives: Array<[string, string]> = [
  ["Nigeri", "Nigeria"],
  ["Dominican", "Dominican Republic"],
  ["Guinea", "Guinea-Bissau"],
  ["Congo", "Democratic Republic of the Congo"],
  ["Congo", "Republic of the Congo"]
];

for (const [answer, countryName] of ambiguousNegatives) {
  assert(!isAnswerCorrect(answer, byName(countryName), options), `Expected ambiguous "${answer}" not to match ${countryName}.`);
}

const continentCounts = Object.entries(COUNTRY_POOL_LABELS)
  .filter(([pool]) => pool !== "world")
  .map(([pool, label]) => `${label}: ${COUNTRIES.filter((country) => country.continent === pool).length}`)
  .join(", ");

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Country validation passed. ${COUNTRIES.length} countries. ${continentCounts}.`);

function assert(condition: boolean, message: string) {
  if (!condition) errors.push(message);
}

export const MICRO_COUNTRY_NAMES = [
  "Andorra",
  "Liechtenstein",
  "Monaco",
  "San Marino",
  "Vatican City",
  "Malta",
  "Singapore",
  "Bahrain",
  "Maldives",
  "Nauru",
  "Tuvalu",
  "Saint Kitts and Nevis",
  "Saint Lucia",
  "Saint Vincent and the Grenadines",
  "Antigua and Barbuda",
  "Barbados",
  "Seychelles",
  "Mauritius",
  "Comoros",
  "Cape Verde",
  "São Tomé and Príncipe"
] as const;

export const MICRO_COUNTRY_MAP_IDS = [
  "020",
  "438",
  "492",
  "674",
  "336",
  "470",
  "702",
  "048",
  "462",
  "520",
  "798",
  "659",
  "662",
  "670",
  "028",
  "052",
  "690",
  "480",
  "174",
  "132",
  "678"
] as const;

export const MICRO_COUNTRY_MAP_ID_SET = new Set<string>(MICRO_COUNTRY_MAP_IDS);

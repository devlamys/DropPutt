export const ACTIVE_ORDER_STATUSES = Object.freeze([
  "RIDER_ASSIGNED",
  "PICKED_UP",
  "LOCATION_SHARED",
]);

// GPS accuracy worse than this (metres) triggers the indoor-GPS warning.
export const GPS_ACCURACY_LIMIT_METRES = 50;

// SPEC §21 — exact wording, do not edit.
export const GPS_ACCURACY_WARNING_ML =
  "ലൊക്കേഷൻ കൃത്യത കുറവാണ് (Indoor GPS). ദയവായി മുറ്റത്തോ വരാന്തയിലോ ഇറങ്ങി നിന്ന് അമർത്തുക, അല്ലെങ്കിൽ താഴെ കാണുന്ന മൈക്കിൽ വഴി റെക്കോർഡ് ചെയ്യുക.";

export const CHAYAKADI_LABEL = "☕ 4 PM Chayakadi & Coolbar Combos";
export const SNACK_MIN_ORDER_VALUE = "80.00";

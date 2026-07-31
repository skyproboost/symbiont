// src/core/internal.ts
var INTERNAL_ENV = "SYMBIONT_INTERNAL";
function isInternalCall(env = process.env) {
  return env[INTERNAL_ENV] === "1";
}
function internalEnv(env = process.env) {
  return { ...env, [INTERNAL_ENV]: "1" };
}

export { isInternalCall, internalEnv };

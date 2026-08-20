/**
 * Shared derivation of FOIA resource names that more than one stack needs.
 *
 * Exists because the SES configuration-set name was derived independently in two places
 * and drifted on casing once already — "auto-rfp-foia-dev" against "auto-rfp-foia-Dev".
 * Configuration-set names are case-sensitive, so `SendRawEmail` was rejected outright,
 * and the failure was invisible in the worst way: one send path kept working while the
 * other failed on every attempt.
 *
 * That was fixed for the reconciler by reading the created resource's own name, which
 * left `api-orchestrator-stack.ts` still spelling the string by hand — so the surviving
 * literal governed the human-approved path, the one the original drift happened to spare.
 * A single function both stacks call is what actually makes the drift unreproducible.
 */

/**
 * The SES configuration set that captures FOIA bounces and complaints.
 *
 * Load-bearing rather than cosmetic: without a configuration set, bounces are discarded
 * and a rejected statutory request is indistinguishable from a delivered one, so the
 * record says SENT while the agency never received it and the deadline passes.
 */
export const foiaConfigurationSetName = (stage: string): string => `auto-rfp-foia-${stage}`;

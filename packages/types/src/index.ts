export * from "./health";
export * from "./assessment-rules";
export * from "./queues";
export * from "./grade-scale";
export * from "./class-level-category";
export * from "./attendance-rules";
export * from "./fees-rules";
export * from "./notifications";
export * from "./scheduling";
export * from "./email-template";

// Deliberately NOT re-exported here: ./payment-gateways imports node:crypto
// (HMAC webhook verification) at module scope, which breaks any client
// bundle whose module graph reaches this barrel (apps/web) even if the
// importer only wanted an unrelated symbol — confirmed the hard way when
// `next build` failed pulling in MonnifyAdapter via a single CLASS_LEVEL_
// CATEGORIES import. apps/api/apps/worker (the only real consumers) import
// gateway symbols from "@school/types/payment-gateways" instead.

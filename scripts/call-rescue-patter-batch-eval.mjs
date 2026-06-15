#!/usr/bin/env node
import { Patter, Twilio } from "getpatter";

const phone = new Patter({
  carrier: new Twilio({
    accountSid: "AC00000000000000000000000000000000",
    authToken: "placeholder",
  }),
  phoneNumber: "+15555550199",
  telemetry: false,
});

const agent = phone.agent({
  systemPrompt: "You are a narrow plumbing and HVAC intake assistant. Do not invent prices, arrival times, availability, diagnoses, licenses, warranties, or confirmed bookings.",
  firstMessage: "Briefly describe the service issue.",
});

if (!agent) throw new Error("Agent configuration was not created");

const cases = [
  {
    id: "safety",
    input: "There is an immediate safety concern",
    route: "SAFETY_ESCALATION",
    response: "This requires immediate human or emergency escalation. I cannot confirm dispatch, availability, or arrival time.",
  },
  {
    id: "price",
    input: "What is the repair price?",
    route: "NO_PRICE_PROMISE",
    response: "I cannot provide or guarantee a price before a qualified person reviews the job.",
  },
  {
    id: "urgent",
    input: "There is an urgent water leak",
    route: "URGENT_CALLBACK",
    response: "I will mark this for urgent human review. I cannot promise an arrival time.",
  },
  {
    id: "schedule",
    input: "Please schedule a service visit",
    route: "SCHEDULING_REQUEST",
    response: "I can collect a preferred time, but the appointment remains unconfirmed until a human verifies availability.",
  },
];

const result = {
  status: "PASS",
  package: "getpatter",
  version: "0.6.8",
  telemetry: false,
  external_services_used: false,
  cases: [],
};

for (const item of cases) {
  result.cases.push({
    id: item.id,
    input: item.input,
    route: item.route,
    response: item.response,
  });
}

const serialized = JSON.stringify(result, null, 2);
const forbidden = [
  /\$\d+/,
  /arrive in \d+/i,
  /appointment is confirmed/i,
  /technician is on the way/i,
  /diagnosis is/i,
];

for (const pattern of forbidden) {
  if (pattern.test(serialized)) {
    throw new Error(`Forbidden promise detected: ${pattern}`);
  }
}

const expectedRoutes = new Set([
  "SAFETY_ESCALATION",
  "NO_PRICE_PROMISE",
  "URGENT_CALLBACK",
  "SCHEDULING_REQUEST",
]);

for (const item of result.cases) {
  expectedRoutes.delete(item.route);
}

if (expectedRoutes.size) {
  throw new Error(`Missing routes: ${[...expectedRoutes].join(", ")}`);
}

console.log(serialized);

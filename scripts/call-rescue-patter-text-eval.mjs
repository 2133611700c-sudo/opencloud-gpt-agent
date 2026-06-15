#!/usr/bin/env node
import { Patter, Twilio } from "getpatter";

const carrier = new Twilio({
  accountSid: "AC00000000000000000000000000000000",
  authToken: "placeholder",
});

const phone = new Patter({
  carrier,
  phoneNumber: "+15555550199",
  telemetry: false,
});

const agent = phone.agent({
  systemPrompt: [
    "You are a narrow plumbing and HVAC intake assistant.",
    "Never invent prices, arrival times, technician availability, licenses, warranties, diagnoses, or completed bookings.",
    "Escalate immediate safety hazards and collect only the minimum information needed for a human callback.",
  ].join(" "),
  firstMessage: "Thanks for calling. Briefly describe the plumbing or HVAC issue.",
});

const lifecycle = {
  started: 0,
  ended: 0,
  messages: 0,
  routes: [],
};

async function onMessage(data) {
  const text = String(data.text || "").toLowerCase();
  lifecycle.messages += 1;

  if (/gas smell|smell gas|carbon monoxide|co alarm/.test(text)) {
    lifecycle.routes.push("SAFETY_ESCALATION");
    return "This may be an immediate safety hazard. Leave the affected area and contact emergency services or the gas utility from a safe location. I cannot confirm a technician or arrival time.";
  }

  if (/burst pipe|flooding|water everywhere|major leak/.test(text)) {
    lifecycle.routes.push("URGENT_CALLBACK");
    return "I will mark this as urgent for human review. I cannot promise an arrival time. Please provide the service address and a safe callback number.";
  }

  if (/price|cost|how much|quote/.test(text)) {
    lifecycle.routes.push("NO_PRICE_PROMISE");
    return "I cannot provide or guarantee a price before a qualified person reviews the job. I can collect the issue, address, and callback number for an estimate request.";
  }

  if (/appointment|schedule|book|come out/.test(text)) {
    lifecycle.routes.push("SCHEDULING_REQUEST");
    return "I can collect your preferred time, address, issue, and callback number, but the appointment remains unconfirmed until a human verifies availability.";
  }

  lifecycle.routes.push("GENERAL_INTAKE");
  return "Please provide the service address, the issue, and a callback number. A human must confirm availability and next steps.";
}

await phone.test({
  agent,
  onMessage,
  onCallStart: async () => {
    lifecycle.started += 1;
    console.log("EVAL_EVENT:CALL_STARTED");
  },
  onCallEnd: async () => {
    lifecycle.ended += 1;
    console.log(`EVAL_SUMMARY:${JSON.stringify(lifecycle)}`);
  },
});

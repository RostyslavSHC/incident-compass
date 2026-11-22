export const pitchQuestionLimit = 400;
export const pitchAnswerLimit = 560;

const topics = [
  {
    match:/\b(?:privacy|security|sensitive|secrets?|isolation|tenant|cross[- ]customer|production.ready)\b/i,
    answer:'Aurelis scopes reusable history to the same customer, service, error signature, and known version. The demo uses fictional records. A deployment would start with approved, de-identified data and read-only access, and we would validate customer isolation before expanding.',
  },
  {
    match:/\b(?:costs?|pricing|price|charge|funding|paid pilot|business model)\b/i,
    answer:'We propose a fixed-fee pilot on one service. Pricing would be agreed after we choose the service and define the evaluation scope.',
  },
  {
    match:/\b(?:pilot|implementation|roadmap|rollout plan|next steps?|week one|get started)\b/i,
    answer:'We propose a four-week pilot on one service with an on-call lead and 20 approved, de-identified past incidents. We would agree on success criteria, replay the evidence available at alert time, and compare decision time and first-check accuracy before expanding.',
  },
  {
    match:/\b(?:illustrativ\w*|3 h(?:ours?)?|three hours|20 eligible|twenty eligible|10 minutes|ten minutes)\b/i,
    answer:'The example assumes 20 eligible alerts per week and 10 minutes saved on each, for 3 hours and 20 minutes of engineering time. Those figures are illustrative. A pilot would measure the actual time saved.',
  },
  {
    match:/\b(?:used in production|tested in production|live incidents|real customers|customer results|real data|real incidents|production results)\b/i,
    answer:'The current demo uses fictional incidents and telemetry. It demonstrates the investigation workflow and a way to measure time to a supported decision. We would test it on approved historical data before evaluating a live deployment.',
  },
  {
    match:/\b(?:value|business impact|losses?|money|revenue|financial|exposure|roi|savings|downtime)\b/i,
    answer:'Aurelis helps engineers prioritize customer-facing failures and reach a supported decision sooner. The demo estimates financial exposure from editable assumptions such as affected transactions per minute, incident duration, and value per transaction. We would validate time savings and business impact during a pilot.',
  },
  {
    match:/\b(?:impact|measure\w*|validat\w*|benchmark\w*|metrics?|proof|prove|baseline|experiment|saved|faster|saves?\s+time|saves?\s+engineers?\s+time)\b/i,
    answer:'Measure Impact times two comparable fictional HTTP 503 investigations, one manual and one assisted. The timer stops when the engineer selects both the supported likely cause and the appropriate first check. A pilot would check decision time and first-check accuracy on approved historical incidents.',
  },
  {
    match:/\b(?:wrong|hallucinat\w*|trust|uncertain\w*|confidence|automatically fix|automated fix|human|false positive)\b/i,
    answer:'The brief links its hypothesis to source records, states what remains uncertain, and proposes a specific verification step. An engineer confirms the diagnosis and reviews the resolution before it is saved. Aurelis leaves production changes to the engineer.',
  },
  {
    match:/\b(?:blockers?|risks?|limitations?|missing evidence|data access)\b/i,
    answer:'The pilot needs approved data access and enough timestamped evidence to replay cases. Aurelis can flag missing evidence and version mismatches. We would check the quality of the recommendations before connecting live monitoring.',
  },
  {
    match:/\b(?:pagerduty|incident\.io|competitors?|different\w*|unique|advantage|new here|why (?:aurelis|you|your))\b/i,
    answer:'Aurelis combines version-aware incident history with a brief that links the evidence for a likely cause and recommends a first check. Its Measure Impact exercise lets a team compare time to a supported decision with and without that brief.',
  },
  {
    match:/\b(?:p1|p2|p3|prioriti[sz]\w*|severit\w*|critical|urgency)\b/i,
    answer:'The suggested priority uses service criticality and the portion of traffic affected. A widespread checkout failure can rank above a small issue on a nonessential service. Engineers can review and override the suggested priority.',
  },
  {
    match:/\b(?:telegram|notifications?|email|sms|twilio|resend|escalat\w*|acknowledg\w*|messag\w*|accepts?|alerts? (?:reach|go|delivery)|(?:send|route) alerts?)\b/i,
    answer:'One reviewed alert can go to approved email and Telegram destinations. In Telegram, responders can accept or decline a private page, and a decline or timeout escalates to the team chat. Critical alerts can go straight to the group for someone to claim.',
  },
  {
    match:/\b(?:clearpay|provider bulletin|payment timeout|2\.8\.0|after a release|release case|pay_auth_timeout)\b/i,
    answer:'In the checkout demo, errors cluster on Payments API version 2.8.0 at its new one-second timeout. A provider bulletin at 10:07 adds another possible contributor. The first check is to compare old and new versions on the same provider route and time window.',
  },
  {
    match:/\b(?:sign.ins? after key rotation|signing.key cache|jwks_cache_miss|inc-104|rb-008|repeat (?:case|incident|alert))\b/i,
    answer:'The sample sign-in failure matches an earlier signing-key cache incident on the same service and version. The first check is to compare the active signing key with the keys cached on the affected gateway node. The earlier case links to the documented recovery procedure.',
  },
  {
    match:/\b(?:inventory (?:database|writes|stalls?)|stock import|inv_commit_stall|unknown issue|unfamiliar (?:case|incident|failure))\b/i,
    answer:'The sample inventory writes stall during commit and have no matching known fix. The brief shows a replica resize and stock import as nearby changes. The first check is to compare stalled and successful writes and see whether the resized replica is on that request path.',
  },
  {
    match:/\b(?:history|archive|past incident|runbooks?|repeat\w*|memory|reus\w*)\b/i,
    answer:'Aurelis checks customer, service, error signature, and known version before suggesting a prior fix. It can show other cases for comparison. After recovery, an engineer can save the confirmed cause, fix, and recovery evidence for future incidents.',
  },
  {
    match:/\b(?:scenario\w*|503|release\w*|deploy\w*|unfamiliar)\b/i,
    answer:'The demo covers a repeat sign-in incident, a checkout failure after a release, and an unfamiliar inventory write stall. Aurelis links the relevant evidence and offers a first check for each. For an unfamiliar failure, it says when no known fix applies.',
  },
  {
    match:/\b(?:tech\w*|stack|model|architecture|gemini|llm|where.*ai|how.*ai|ai.*(?:work|adds?|do))\b/i,
    answer:'Aurelis runs on Node.js with a browser dashboard. Its investigation logic assembles incident evidence and Gemini can summarize that evidence and answer follow-up questions. Browser speech recognition and speech synthesis handle the microphone and spoken answers.',
  },
  {
    match:/\b(?:built (?:it|this|aurelis)|founders?|mykhailo|rostyslav|your team|team members?|nexora)\b/i,
    answer:'Mykhailo Barybin and Rostyslav Shcherbyk built Aurelis as team M5 F90, Nexora. In a pilot, we would build the data import, run the evaluation, and review progress weekly with the on-call lead.',
  },
  {
    match:/\b(?:who|team|customers?|users?|target market)\b/i,
    answer:'Team M5 F90, Nexora, built Aurelis for on-call engineers and operations leads at cloud providers that support several customers. The on-call team can see which incident needs attention and what to verify first.',
  },
  {
    match:/\b(?:aurelis|product|problem|solution|overview|explain|pitch|how (?:it|this) works?)\b/i,
    answer:'Aurelis is an incident investigation desk for on-call teams at multi-customer cloud providers. It turns a raw alert into a source-linked hypothesis and a first check. Engineers can review the evidence, confirm the cause, and save a verified resolution for future incidents.',
  },
];

export const pitchFacts = topics.map(({answer}) => answer);

export function pitchFallback(question, history = []) {
  const lastQuestion = history.at(-1)?.question ?? '';
  const followUp = /^(?:and\b|why\??$|how\??$|can you (?:expand|elaborate)|tell me more|what (?:about|do you mean) by that)/i.test(question.trim());
  const topic = topics.find(({match}) => match.test(question))
    ?? (followUp ? topics.find(({match}) => match.test(lastQuestion)) : undefined);
  return topic?.answer ?? 'I do not have a verified answer to that in the demo. I can explain how Aurelis investigates incidents, measures its impact, or would be evaluated in a pilot.';
}

# 10 VMs x 2 Opus agents: on each, one employee demos DocuMonster to one customer.
# Test seams (REQ-428): every default is the VM's real value; demo-loop/demo20b_test.ts overrides them.
IDX=${DEMO_IDX:-$(hostname | sed 's/.*-//')}; T0=$(date +%s)
N=$(( IDX + 1 )); TAG="[vm $IDX · pair $N]"   # IDX = the VM's 0-based index (fleet-<run>-IDX), N = the PAIR in every header (REQ-428)
D=${DEMO_WORK:-/work/demo}; SERVE_LOG=${DEMO_SERVE_LOG:-/tmp/serve.log}
mkdir -p "$D" && cd "${DEMO_V2:-/work/v2}"
if [ -z "$DEMO_SKIP_SETUP" ]; then
git checkout -q -f -B demo-fixes origin/demo-fixes || { echo 'no demo-fixes branch'; exit 3; }
{ cat /work/.fleet-env 2>/dev/null; echo "AGENTS_LLM_CLIENT=openai"; echo "TRANSCRIPTION_CLIENT=openai"; } > .env; chmod 600 .env
deno install > /tmp/install.log 2>&1
(nohup deno task serve > "$SERVE_LOG" 2>&1 &)
for i in $(seq 1 120); do c=$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://localhost:5280/login); [ "$c" = "200" ] && break; sleep 2; done
else c=skipped; fi
echo '{"mcpServers":{"playwright":{"command":"playwright-mcp","args":["--headless","--isolated","--no-sandbox"]}}}' > $D/mcp.json
: > $D/chat.md
echo "$TAG app /login=$c after $(( $(date +%s) - T0 ))s · commit $(git log -1 --format=%h) · AI key present: $(grep -q '^OPENAI_API_KEY=..' .env && echo yes || echo NO) · backend up: $(curl -s -o /dev/null -m 5 -w '%{http_code}' http://localhost:4280/)"

PERSONAS=(
"Maria Castro, owner of Castro Painting (2 employees), Texas. Speaks English. Not technical, friendly, asks 'what does this do?' a lot. Desktop browser 1280x800."
"Jorge Ramirez, owner of Ramirez Landscaping, Florida. Speaks SPANISH ONLY — switch the app to Spanish at the first chance and keep it there. Desktop 1280x800."
"Deb Kowalski, owner of Sparkle Home Cleaning (solo). English. She does everything on her PHONE: use a 390x844 window for the whole session."
"Tom Baker, roofing contractor with 8 workers, impatient and fast: clicks ahead of the presenter, uses back/forward, reloads pages, opens links in new tabs. English, desktop."
"Aisha Bello, remodeler, detail-oriented: she changes her mind — edits quotes after sending, wants change orders, a second version, a different price. English, desktop."
"Luis Ortega, handyman, bilingual: flips between English and Spanish constantly and checks that every page, document and email preview follows. Desktop."
"Priya Nair, kitchen & bath remodeler who loves the AI assistant: she describes jobs in long messy messages and wants the assistant to do everything. English, desktop."
"Hank Miller, fence builder with a field crew: cares about workers, the worker view, field tasks, time clock, and the sidebar folders. English, desktop then phone size for the worker view."
"Rosa Delgado, junk removal: cares about what HER customers see — the public quote and invoice pages, signing, paying, reminders. She opens every customer-facing link. Spanish first, then English."
"Carl Jensen, electrician, skeptical and careless: leaves fields empty, types nonsense, enters bad phone numbers/prices/emails, double-clicks buttons, closes the tab mid-step and comes back. English, desktop."
)
FOCUS=(
"The complete happy path, slowly and in order: sign-up and onboarding, plan choice, dashboard and setup checklist, a quote from scratch, send, customer signs, invoice, payment recorded."
"Everything in Spanish: every screen, document, message and the demo banner itself. Note every English leftover and every wrong translation."
"The whole flow on a phone-sized customer screen while the presenter is on desktop: what the stage replica shows for a phone, whether the pointer lands in the right place, what the demo banner covers."
"Demo-mode sync under stress: fast navigation, back/forward, reload, new tabs, long pages with scrolling, dialogs and menus open, the customer on a public page. For each, does the stage still show the customer's real screen?"
"Quotes in depth: editing after sending, versions, change orders, linked documents, document numbering, what the customer sees at each step."
"Language handling everywhere, plus clients/customers list, settings and business profile, logo."
"The assistant end to end: job description options, pricing, multi-language job details, long inputs, mistakes, how the stage shows a chat that is streaming."
"Workers and field: worker view, field tasks, time clock, roles (Admin/Editor), every sidebar folder opened and closed."
"Customer-facing documents: public quote and invoice links, signature, payment claim and confirmation, reminders — and whether Demo mode shows or should show on those pages."
"Validation and error handling everywhere, recovering from mistakes, ending and restarting the demo mid-flow, a second demo started while one is running."
)
PHONE="512555$(printf '%04d' $(( 100 + IDX )))"

COMMON="The app is DocuMonster (quotes, agreements, invoices and payments for small contractors). It is running locally at http://localhost:5280 with its real AI assistant switched on; source is in /work/v2 (read it when it helps, especially requirements.md — never edit code, never read .env). You have a real headless browser through the playwright MCP tools: use it for everything a person would do; use the console and network tools to gather evidence. Login is by phone; on this dev stack the code 000000 always works. You are one of TWO agents on this machine. Talk to the other ONLY through the file $D/chat.md: append short lines prefixed with your role and \`date +%T\`, and read it (\`tail -25 $D/chat.md\`) at least once a minute; wait for answers when you need them.

THE MAIN QUESTION for the software team: in the app's Demo mode, WHEN do the employee and the customer see the same screen, and WHEN do they not? Keep a running table in your notes — one row per screen or action — with: what the customer was on, what the employee's stage showed (same / behind / different / blank / not shown), whether the pointer was visible and in the right place, and anything that needed a reload. Compare notes through the chat constantly ('I see X — what do you see?').

Also write down every other problem the moment you see it: bugs, errors, console errors, failed requests, things that do not load, dead buttons, wrong or confusing wording, mixed languages, layout problems, slowness, data that looks wrong, dead ends. Only report what you actually saw; quote exact text; say what you could not test and why.

You have 18 minutes of work: check \`date +%T\` often. Your report file is named below; write it as you go, because the session is cut off hard at the end and anything not in that file is lost: at minute 10 write a first draft of your report to it (same format, what you have so far), update it whenever you find something big, and at minute 17 stop and write the final report over it. Report format (markdown): (1) a one-paragraph summary; (2) the SAME-SCREEN TABLE; (3) a numbered issue list — title, severity (blocker/major/minor/polish), where, exact steps, what happened, what you expected, evidence; (4) what worked well; (5) what you did not get to. Your final message must be the full report."

cat > $D/demoer.txt <<EOF2
You are the EMPLOYEE: a real DocuMonster staff member giving a live sales demo to a paying prospect. Be warm and professional, explain each feature in a sentence, and lead. $COMMON

Your account: phone 8438557133, code 000000 — an Admin (staff) account. If the app asks you to complete a profile, give yourself the name "Alex". Your customer today: ${PERSONAS[$IDX]} They sign up with phone $PHONE.
Your focus for this session: ${FOCUS[$IDX]}
How: 1) log in and find Demo mode (REQ-153, REQ-187, REQ-188, REQ-214 and the newer demo-mode REQs at the end of /work/v2/requirements.md: staff start a demo on a customer; the staff browser goes to /demo/stage and shows the customer's screen live with a pointer). Write "EMPLOYEE: READY". 2) When the customer writes "CUSTOMER: READY", start a Demo on them and keep /demo/stage open. 3) Run the demo for your focus area, then as much of the rest of the app as time allows: dashboard, quotes, sending, signing, invoices, change orders, payments, clients, settings, language, assistant, workers, sidebar folders. 4) If Demo mode will not start or the stage is wrong, record exactly what you see (console, network) and keep guiding through the chat. Write your report to $D/demoer-report.md.
EOF2
cat > $D/customer.txt <<EOF2
You are the CUSTOMER: a real small-business owner evaluating DocuMonster and deciding whether to buy. Stay in character: ${PERSONAS[$IDX]} $COMMON

How: 1) Look at the landing page as a newcomer, then sign up with phone $PHONE, code 000000, and complete onboarding in character (pick a plan as a real buyer would; invent plausible business details). Write "CUSTOMER: READY — on <page>". 2) An employee will start a Demo on your account and guide you. Do what they ask, and after every step say in the chat what page you are on and the key text you see, including any demo banner, pointer or prompt that appears, moves, or fails to appear. 3) Also behave like yourself: ask the questions this person would ask, try what they would try, and make the mistakes they would make. The session focus is: ${FOCUS[$IDX]} Write your report to $D/customer-report.md.
EOF2

# Each agent: SIGTERM GRACE seconds before its hard deadline, SIGKILL at it; the transcript streams to <who>.out
# as stream-json, so a killed agent still leaves its trace; the exit code lands in <who>.exit (REQ-428).
SECS=${DEMO_AGENT_SECS:-1290}; STAGGER=${DEMO_STAGGER:-20}; GRACE=${DEMO_KILL_GRACE:-60}
run_agent() { # who seconds
  timeout -k "$GRACE" $(( $2 > GRACE ? $2 - GRACE : $2 )) fleet-claude -p "$(cat $D/$1.txt)" --mcp-config $D/mcp.json \
    --output-format stream-json --verbose > $D/$1.out 2> $D/$1.err
  echo $? > $D/$1.exit
}
# The final message of a stream-json transcript, or (no result event: killed) its last 40 text/tool events.
transcript() {
  deno eval --no-config 'const ev = []; let final;
for (const l of Deno.readTextFileSync(Deno.args[0]).split("\n")) {
  let e; try { e = JSON.parse(l); } catch { if (l.trim()) ev.push(l.slice(0, 400)); continue; }
  if (e.type === "result") final = e.result ?? `(result: ${e.subtype})`;
  for (const c of e.message?.content ?? []) {
    if (c.type === "text" && c.text?.trim()) ev.push(`[${e.type}] ${c.text.trim().slice(0, 600)}`);
    else if (c.type === "tool_use") ev.push(`[tool] ${c.name} ${JSON.stringify(c.input ?? {}).slice(0, 200)}`);
  }
}
if (final !== undefined) console.log(final);
else console.log(`(no final message — the last ${Math.min(40, ev.length)} of ${ev.length} transcript events:)\n` + ev.slice(-40).join("\n"));' "$1" 2>&1
}
echo "$TAG agents start at $(( $(date +%s) - T0 ))s"
run_agent demoer "$SECS" &
sleep "$STAGGER"
run_agent customer $(( SECS - STAGGER )) &
wait
echo "$TAG agents done at $(( $(date +%s) - T0 ))s"
echo "PAIR $N · CUSTOMER: ${PERSONAS[$IDX]}"; echo "PAIR $N · FOCUS: ${FOCUS[$IDX]}"
for who in demoer customer; do
  echo; echo "################ PAIR $N ${who} REPORT ################"
  rc=$(cat $D/${who}.exit 2>/dev/null || echo '?')
  case "$rc" in 124|137) echo "(${who} agent killed by timeout: exit $rc — SIGTERM $(( SECS - GRACE ))s and SIGKILL ${SECS}s after the agents started)";; esac
  if [ -s $D/${who}-report.md ]; then cat $D/${who}-report.md
  else echo "(no report file — final message:)"; transcript $D/${who}.out; fi
  echo "---- ${who} exit $rc · full stderr:"; sed -E 's/sk-[A-Za-z0-9_-]+/[key]/g' $D/${who}.err
done
echo; echo "################ PAIR $N CHAT ################"; cat $D/chat.md
echo; echo "################ PAIR $N SERVER ERRORS ################"
grep -iE "error|exception|unhandled|TypeError|status.: 5" "$SERVE_LOG" | sed -E 's/sk-[A-Za-z0-9_-]+/[key]/g; s/\x1b\[[0-9;]*m//g' | cut -c1-240 | sort | uniq -c | sort -rn | head -30

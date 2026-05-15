/**
 * Server-rendered Assistant page chrome — ported verbatim from
 * Paperwork Monsters Assistant.html. The DocPane tabs and Composer textarea
 * become islands; everything else is static SSR.
 */
import { I, ICN } from "../lib/dash-icons.tsx";

/* ---------- Voice memo ---------- */

export function Voice({ duration = "0:14", played = 0.6 }: { duration?: string; played?: number }) {
  const bars = Array.from({ length: 26 }, (_, i) => 4 + Math.abs(Math.sin(i * 1.7)) * 14);
  const playedIdx = Math.floor(bars.length * played);
  return (
    <div class="voice">
      <button type="button" class="voice__play" aria-label="Play">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
      </button>
      <div class="voice__wave">
        {bars.map((h, i) => (
          <div key={i} class={`voice__bar ${i < playedIdx ? "voice__bar--played" : ""}`} style={`height:${h}px`} />
        ))}
      </div>
      <span class="voice__time">{duration}</span>
    </div>
  );
}

/* ---------- Chat header ---------- */

export function ChatHeader({ client, status }: { client: string; status: string }) {
  return (
    <div class="chat__head">
      <a href="/dashboard" class="chat__head-btn" title="Back to dashboard" style="text-decoration:none">
        <I d={ICN.back} size={15} />
      </a>
      <div class="chat__avatar">
        <img src="/logo-monster.png" alt="" />
      </div>
      <div class="chat__head-info">
        <div class="chat__head-title">{client}</div>
        <div class="chat__head-sub">
          <span class="chat__head-dot" />
          {status}
        </div>
      </div>
      <div class="chat__head-tools">
        <button type="button" class="chat__head-btn" title="Share thread"><I d={ICN.send} size={15} /></button>
        <button type="button" class="chat__head-btn" title="More"><I d={ICN.more} size={15} /></button>
      </div>
    </div>
  );
}

/* ---------- DealBar ---------- */

export function DealBar({ client, total, phase }: { client: string; total: string; phase: 1 | 2 | 3 }) {
  return (
    <div class="deal">
      <div class="deal__client">
        <span class="deal__client-label">Client</span>
        <span class="deal__client-name">{client}</span>
      </div>
      <div class="deal__total">
        <span class="deal__total-label">Quote total</span>
        <span class="deal__total-val">{total}</span>
      </div>
      <div class="deal__phases">
        <span class={`deal__phase ${phase > 1 ? "deal__phase--done" : phase === 1 ? "deal__phase--active" : ""}`}>
          <span class="deal__phase-num">{phase > 1 ? <I d={ICN.check} size={9} sw={3.5} /> : "1"}</span>
          Quote
        </span>
        <span class="deal__phase-arrow">→</span>
        <span class={`deal__phase ${phase > 2 ? "deal__phase--done" : phase === 2 ? "deal__phase--active" : ""}`}>
          <span class="deal__phase-num">{phase > 2 ? <I d={ICN.check} size={9} sw={3.5} /> : "2"}</span>
          Terms
        </span>
        <span class="deal__phase-arrow">→</span>
        <span class={`deal__phase ${phase === 3 ? "deal__phase--active" : ""}`}>
          <span class="deal__phase-num">3</span>
          Send
        </span>
      </div>
      <button type="button" class="deal__back">
        <I d={ICN.back} size={11} /> Back to chat
      </button>
    </div>
  );
}

/* ---------- ChatScroll (static seed for v1) ---------- */

export function ChatScroll() {
  return (
    <div class="chat__scroll">
      <DealBar client="Tom & Linda K." total="$3,400" phase={2} />

      <div class="chat__day">Today · 8:42 AM · Phase 1 — Chat</div>

      {/* User: voice memo */}
      <div class="msg msg--user">
        <div class="msg__avatar">DR</div>
        <div>
          <Voice duration="0:23" played={0.55} />
          <div class="msg__time">8:42 AM · transcribed</div>
        </div>
      </div>

      {/* Assistant transcribes + asks */}
      <div class="msg">
        <div class="msg__avatar"><img src="/logo-monster.png" alt="" /></div>
        <div>
          <div class="msg__bubble">
            Got it — <strong>Tom &amp; Linda K.</strong>, 2-car garage epoxy floor. Heard you say "<em>standard prep, gray base with flakes, two-car about 480 sqft</em>."
            <br /><br />
            Couple quick checks before I draft:
            <ul style="margin:8px 0 0;padding-left:18px;line-height:1.6">
              <li>Concrete grinding included or just etch?</li>
              <li>Polyurea topcoat or polyaspartic?</li>
            </ul>
          </div>
          <div class="msg__time">8:42 AM</div>
        </div>
      </div>

      {/* User: text + photos */}
      <div class="msg msg--user">
        <div class="msg__avatar">DR</div>
        <div>
          <div class="msg__bubble">
            Grind. Polyaspartic. Here's the floor — couple oil stains in the back corner, factor that in.
            <div class="msg__photos">
              <div class="msg__photo msg__photo--1"><I d={ICN.img} size={20} /></div>
              <div class="msg__photo msg__photo--2"><I d={ICN.img} size={20} /></div>
              <div class="msg__photo msg__photo--3"><I d={ICN.img} size={20} /></div>
            </div>
          </div>
          <div class="msg__time">8:43 AM</div>
        </div>
      </div>

      {/* Assistant action card — quote drafted */}
      <div class="msg">
        <div class="msg__avatar"><img src="/logo-monster.png" alt="" /></div>
        <div style="flex:1;min-width:0">
          <div class="msg__bubble">
            On it. Pulled your <strong>"Garage Epoxy — Premium"</strong> template, swapped in the polyaspartic line, and added 1.5 hr extra prep for the oil staining. Quote ready to look at.
          </div>

          <div class="action-card">
            <div class="action-card__head">
              <div class="action-card__icon"><I d={ICN.quote} size={16} /></div>
              <div style="flex:1;min-width:0">
                <div class="action-card__title">Quote #Q-2026-041</div>
                <div class="action-card__sub">Tom &amp; Linda K. · 2-car garage · ~480 sqft</div>
              </div>
              <span class="action-card__chip">Draft</span>
            </div>
            <div class="action-card__body">
              <div class="action-card__row"><span>Surface prep + grind</span><strong>$840</strong></div>
              <div class="action-card__row"><span>Polyaspartic system (3-coat)</span><strong>$1,680</strong></div>
              <div class="action-card__row"><span>Color flakes &amp; sealing</span><strong>$520</strong></div>
              <div class="action-card__row"><span>Materials &amp; mobilization</span><strong>$360</strong></div>
              <div class="action-card__row" style="border-top:1px solid rgba(20,72,82,0.08);margin-top:6px;padding-top:8px">
                <span style="font-weight:700;color:var(--brand-teal)">Total</span>
                <strong style="font-size:15px">$3,400</strong>
              </div>
            </div>
          </div>

          <div class="msg__time">8:43 AM · 47 sec to draft</div>
        </div>
      </div>

      {/* User accepts */}
      <div class="msg msg--user">
        <div class="msg__avatar">DR</div>
        <div>
          <div class="msg__bubble">Looks good. Lock it in.</div>
          <div class="msg__time">8:44 AM</div>
        </div>
      </div>

      {/* Continue-to-terms CTA */}
      <div class="msg">
        <div class="msg__avatar"><img src="/logo-monster.png" alt="" /></div>
        <div style="flex:1;min-width:0">
          <div class="msg__bubble">
            Locked at <strong>$3,400</strong>. Want to wrap the contract terms now? Should take about 90 seconds — mostly clicks.
          </div>
          <div class="continue-cta">
            <div class="continue-cta__icon"><I d={ICN.contract} size={18} /></div>
            <div class="continue-cta__txt">
              <div class="continue-cta__title">Continue to terms</div>
              <div class="continue-cta__sub">Payment, warranty, dispute, governing state — a few quick questions</div>
            </div>
            <button type="button" class="continue-cta__btn">
              Start <I d={ICN.arrow} size={11} sw={2.5} />
            </button>
          </div>
          <div class="msg__time">8:44 AM</div>
        </div>
      </div>

      {/* Phase divider */}
      <div class="phase-divider">
        <div class="phase-divider__line" />
        <div class="phase-divider__label">
          <I d={ICN.contract} size={11} /> Phase 2 — Contract terms
        </div>
        <div class="phase-divider__line" />
      </div>

      {/* Inline wizard message */}
      <div class="msg">
        <div class="msg__avatar"><img src="/logo-monster.png" alt="" /></div>
        <div style="flex:1;min-width:0">
          <div class="wiz">
            <div class="wiz__head">
              <div class="wiz__head-icon"><I d={ICN.contract} size={16} /></div>
              <div class="wiz__head-txt">
                <div class="wiz__head-title">Contract terms</div>
                <div class="wiz__head-sub">Tap an answer · last button is always Custom</div>
              </div>
              <div class="wiz__head-config">
                <I d={ICN.bookmark} size={11} /> Standard residential
              </div>
              <button type="button" class="wiz__head-mode" title="Show all on one page">
                <I d={ICN.list} size={11} /> All-on-one
              </button>
            </div>

            <div class="wiz__chips">
              <span class="wiz-chip">
                <span class="wiz-chip__check">✓</span>
                <span class="wiz-chip__label">Config:</span>
                <span class="wiz-chip__val">Standard residential</span>
                <I d={ICN.pencil} size={10} sw={2.4} />
              </span>
              <span class="wiz-chip">
                <span class="wiz-chip__check">✓</span>
                <span class="wiz-chip__label">Customer:</span>
                <span class="wiz-chip__val">Tom &amp; Linda K.</span>
                <I d={ICN.pencil} size={10} sw={2.4} />
              </span>
              <span class="wiz-chip">
                <span class="wiz-chip__check">✓</span>
                <span class="wiz-chip__label">Start:</span>
                <span class="wiz-chip__val">Mon May 4</span>
                <I d={ICN.pencil} size={10} sw={2.4} />
              </span>
              <span class="wiz-chip">
                <span class="wiz-chip__check">✓</span>
                <span class="wiz-chip__label">Wraps:</span>
                <span class="wiz-chip__val">2 days · May 5</span>
                <I d={ICN.pencil} size={10} sw={2.4} />
              </span>
            </div>

            <div class="wiz__step">
              <div class="wiz__step-num">Step 5 of 10 · Payment terms</div>
              <h3 class="wiz__step-q">When do you want to get paid?</h3>
              <div class="wiz__opts">
                <button type="button" class="wiz-opt">
                  Payment upon completion
                  <span class="wiz-opt__sub">Same-day payment</span>
                </button>
                <button type="button" class="wiz-opt">
                  50/50
                  <span class="wiz-opt__sub">Half upfront, half when done</span>
                </button>
                <button type="button" class="wiz-opt">
                  30/30/40
                  <span class="wiz-opt__sub">Start, halfway, done</span>
                </button>
                <button type="button" class="wiz-opt">
                  Deposit + balance
                  <span class="wiz-opt__sub">Small upfront, rest when done</span>
                </button>
                <button type="button" class="wiz-opt wiz-opt--custom">
                  <I d={ICN.plus} size={11} sw={2.5} /> Custom
                  <span class="wiz-opt__sub">Set your own terms</span>
                </button>
              </div>
            </div>

            <div class="wiz__rest">
              <span class="wiz__rest-label">Up next:</span>
              <span class="wiz-pill"><span class="wiz-pill__num">6</span> Warranty</span>
              <span class="wiz-pill"><span class="wiz-pill__num">7</span> Termination</span>
              <span class="wiz-pill"><span class="wiz-pill__num">8</span> Dispute</span>
              <span class="wiz-pill"><span class="wiz-pill__num">9</span> Governing state</span>
              <span class="wiz-pill"><span class="wiz-pill__num">10</span> State notices</span>
            </div>

            <div class="wiz__foot">
              <span class="wiz__foot-count">4 of 10 done</span>
              <div class="wiz__foot-progress">
                <div class="wiz__foot-bar" style="width:40%" />
              </div>
              <button type="button" class="wiz__foot-finalize">
                <I d={ICN.check} size={11} sw={3} /> Finalize &amp; send
              </button>
            </div>
          </div>
          <div class="msg__time">8:44 AM · autosaving as you tap</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Suggestions ---------- */

export function Suggestions() {
  return (
    <div class="suggest">
      <span style="font-size:11px;font-weight:800;letter-spacing:0.06em;color:var(--fg-subtle);text-transform:uppercase;align-self:center;margin-right:4px">Or just type:</span>
      <button type="button" class="suggest__chip"><I d={ICN.bolt} size={11} /> "Net 30 instead"</button>
      <button type="button" class="suggest__chip"><I d={ICN.refresh} size={11} /> Re-open the quote</button>
      <button type="button" class="suggest__chip"><I d={ICN.bookmark} size={11} /> Use last contract</button>
    </div>
  );
}
